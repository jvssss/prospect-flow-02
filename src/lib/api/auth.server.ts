import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { erros } from "./errors";

export type Db = SupabaseClient<Database>;

export type Contexto = {
  userId: string;
  /** Com JWT: cliente do usuário (RLS). Com chave de API: cliente de serviço, sempre filtrado por userId. */
  db: Db;
  via: "jwt" | "api_key";
  keyId?: string;
  request: Request;
  params: Record<string, string>;
  origin: string;
};

export const PREFIXO_CHAVE = "pf_";

export async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação em tempo constante, para segredos. */
export function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function gerarChave(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${PREFIXO_CHAVE}live_${b64}`;
}

function extrairCredencial(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    if (!auth.toLowerCase().startsWith("bearer ")) throw erros.naoAutenticado("Use o cabeçalho Authorization: Bearer <token>.");
    return auth.slice(7).trim() || null;
  }
  return request.headers.get("x-api-key")?.trim() || null;
}

async function admin(): Promise<Db> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw erros.config(
      "SUPABASE_SERVICE_ROLE_KEY não configurada: chaves de API e rotinas automáticas dependem dela.",
    );
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

export async function clienteAdmin(): Promise<Db> {
  return admin();
}

export async function autenticar(request: Request, params: Record<string, string> = {}): Promise<Contexto> {
  const cred = extrairCredencial(request);
  if (!cred) throw erros.naoAutenticado();
  const origin = new URL(request.url).origin;

  // --- Chave de API ---
  if (cred.startsWith(PREFIXO_CHAVE)) {
    const db = await admin();
    const hash = await sha256Hex(cred);
    const { data, error } = await (db as unknown as SupabaseClient)
      .from("api_keys")
      .select("id,user_id,revoked_at")
      .eq("key_hash", hash)
      .maybeSingle();
    if (error) throw erros.interno("Não foi possível validar a chave de API.");
    if (!data || data.revoked_at) throw erros.naoAutenticado("Chave de API inválida ou revogada.");
    // Marca o uso sem bloquear a resposta nem derrubar a requisição se falhar.
    void (db as unknown as SupabaseClient)
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(() => undefined, () => undefined);
    return { userId: data.user_id, db, via: "api_key", keyId: data.id, request, params, origin };
  }

  // --- JWT do Supabase ---
  if (cred.split(".").length !== 3) throw erros.naoAutenticado("Token inválido.");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw erros.config("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY não configuradas.");

  const db = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${cred}`, apikey: key } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getClaims(cred);
  if (error || !data?.claims?.sub) throw erros.naoAutenticado("Token inválido ou expirado.");
  return { userId: data.claims.sub, db, via: "jwt", request, params, origin };
}

/** Rotinas agendadas: segredo compartilhado, sem usuário. */
export function autenticarCron(request: Request): void {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) throw erros.config("CRON_SECRET não configurado.");
  const auth = request.headers.get("authorization");
  const recebido = auth?.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : (request.headers.get("x-cron-secret") ?? "");
  if (!recebido || !iguaisSeguro(recebido, segredo)) throw erros.naoAutenticado("Segredo da rotina inválido.");
}
