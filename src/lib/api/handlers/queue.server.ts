import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { protegido } from "../handler.server";
import { lerQuery, ok, qInt } from "../http";
import { erros } from "../errors";

const sb = (c: { db: unknown }) => c.db as SupabaseClient;

const STATUS_ELEGIVEIS = ["new", "no_answer", "gatekeeper", "callback"];

const consulta = z.object({
  cidade: z.string().trim().min(1).max(120),
  limit: qInt(20, 1, 100),
  excluir: z.string().max(4000).optional(), // ids já tratados, separados por vírgula
});

type Lead = Record<string, any>;

/** 0 = follow-up marcado, 1 = retorno vencido, 2 = nunca ligado, 3 = o resto. */
export function prioridade(l: Lead, agora: number): number {
  if (l.followup_at) return 0;
  if (l.retorno_agendado_em && new Date(l.retorno_agendado_em).getTime() <= agora) return 1;
  if (!l.last_call_at) return 2;
  return 3;
}

function chaveOrdem(l: Lead): number {
  if (l.followup_at) return new Date(l.followup_at).getTime();
  if (l.retorno_agendado_em) return new Date(l.retorno_agendado_em).getTime();
  if (l.last_call_at) return new Date(l.last_call_at).getTime();
  return 0;
}

export function ordenarFila(leads: Lead[], agora = Date.now()): Lead[] {
  return [...leads].sort((a, b) => {
    const pa = prioridade(a, agora);
    const pb = prioridade(b, agora);
    if (pa !== pb) return pa - pb;
    const ka = chaveOrdem(a);
    const kb = chaveOrdem(b);
    if (ka !== kb) return ka - kb;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Fila do Modo Foco. Busca os prioritários (follow-up e retorno vencido) numa
 * consulta própria: se viessem só da fila geral, um lead com follow-up já
 * ligado cairia fora do lote e nunca seria visto.
 */
export const fila = protegido(async (c) => {
  const f = lerQuery(c.request, consulta);
  const excluir = new Set((f.excluir ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const agoraIso = new Date().toISOString();
  const base = () =>
    sb(c).from("leads").select("*").eq("user_id", c.userId).ilike("cidade", f.cidade).in("status", STATUS_ELEGIVEIS);

  const [follow, retorno, normal] = await Promise.all([
    base().not("followup_at", "is", null).order("followup_at", { ascending: true }).limit(50),
    base().not("retorno_agendado_em", "is", null).lte("retorno_agendado_em", agoraIso).order("retorno_agendado_em", { ascending: true }).limit(50),
    base().order("last_call_at", { ascending: true, nullsFirst: true }).order("id", { ascending: true }).limit(Math.max(30, f.limit)),
  ]);
  for (const r of [follow, retorno, normal]) if (r.error) throw erros.interno(r.error.message);

  const vistos = new Set<string>();
  const juntos: Lead[] = [];
  for (const l of [...(follow.data ?? []), ...(retorno.data ?? []), ...(normal.data ?? [])]) {
    if (vistos.has(l.id) || excluir.has(l.id)) continue;
    vistos.add(l.id);
    juntos.push(l);
  }
  const agora = Date.now();
  const ordenados = ordenarFila(juntos, agora).slice(0, f.limit);
  return ok(
    ordenados.map((l) => ({ ...l, prioridade: prioridade(l, agora) })),
    { cidade: f.cidade, total_retornado: ordenados.length },
  );
});

/** Cidades com leads e quantos ainda estão na fila. */
export const cidades = protegido(async (c) => {
  const { data, error } = await sb(c)
    .from("leads")
    .select("cidade,uf,status")
    .eq("user_id", c.userId)
    .not("cidade", "is", null)
    .limit(20000);
  if (error) throw erros.interno(error.message);
  const mapa = new Map<string, { cidade: string; uf: string | null; total: number; na_fila: number }>();
  for (const l of data ?? []) {
    const k = `${l.cidade}|${l.uf ?? ""}`;
    const m = mapa.get(k) ?? { cidade: l.cidade, uf: l.uf ?? null, total: 0, na_fila: 0 };
    m.total++;
    if (STATUS_ELEGIVEIS.includes(l.status)) m.na_fila++;
    mapa.set(k, m);
  }
  return ok([...mapa.values()].sort((a, b) => b.na_fila - a.na_fila));
});
