import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clienteAdmin, gerarChave, sha256Hex } from "../auth.server";
import { protegido } from "../handler.server";
import { erros } from "../errors";
import { lerCorpo, ok } from "../http";

const MAX_CHAVES_ATIVAS = 10;

const corpo = z.object({ nome: z.string().trim().min(2).max(60) });

/** GET /me — quem está autenticado e como. */
export const eu = protegido(async (c) => ok({ user_id: c.userId, via: c.via, chave_id: c.keyId ?? null }));

/** GET /api-keys — chaves do usuário (nunca o valor, só o prefixo). */
export const listarChaves = protegido(async (c) => {
  const admin = (await clienteAdmin()) as unknown as SupabaseClient;
  const { data, error } = await admin
    .from("api_keys")
    .select("id,name,prefix,created_at,last_used_at,revoked_at")
    .eq("user_id", c.userId)
    .order("created_at", { ascending: false });
  if (error) throw erros.interno(error.message);
  return ok(data ?? []);
});

/**
 * POST /api-keys — gera uma chave. O valor completo aparece UMA vez, nesta
 * resposta; só o hash SHA-256 fica no banco. Chave de API não cria outras
 * chaves: quem vazar uma não ganha acesso permanente.
 */
export const criarChave = protegido(
  async (c) => {
    if (c.via !== "jwt") throw erros.proibido("Chaves de API só podem ser criadas com o login do painel.");
    const { nome } = await lerCorpo(c.request, corpo);
    const admin = (await clienteAdmin()) as unknown as SupabaseClient;

    const { count } = await admin
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", c.userId)
      .is("revoked_at", null);
    if ((count ?? 0) >= MAX_CHAVES_ATIVAS) throw erros.conflito(`Limite de ${MAX_CHAVES_ATIVAS} chaves ativas. Revogue alguma antes.`);

    const chave = gerarChave();
    const { data, error } = await admin
      .from("api_keys")
      .insert({ user_id: c.userId, name: nome, key_hash: await sha256Hex(chave), prefix: chave.slice(0, 12) })
      .select("id,name,prefix,created_at")
      .single();
    if (error) throw erros.interno(error.message);
    return ok({ ...data, chave }, { aviso: "Guarde esta chave agora: ela não será mostrada de novo." }, 201);
  },
  { limitePorMinuto: 10 },
);

/** DELETE /api-keys/:id — revoga. */
export const revogarChave = protegido(async (c) => {
  if (!z.string().uuid().safeParse(c.params.id).success) throw erros.invalido("ID inválido.");
  const admin = (await clienteAdmin()) as unknown as SupabaseClient;
  const { data, error } = await admin
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", c.params.id)
    .eq("user_id", c.userId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw erros.interno(error.message);
  if (!data?.length) throw erros.naoEncontrado("Chave");
  return ok({ id: c.params.id, revogada: true });
});
