import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { protegido } from "../handler.server";
import { erros } from "../errors";
import { lerCorpo, lerQuery, ok } from "../http";
import { baseLocalPara, verificarEGravar, verificarLeadRow, type LeadQsaRow } from "@/lib/qsa/pipeline.server";
import { montarAtualizacaoLead } from "@/lib/qsa/aplicar";
import { buscarCnpjPorTexto } from "@/lib/qsa/busca-web";
import { resolverQsa } from "@/lib/qsa/resolve";
import { cnpjValido, soDigitos } from "@/lib/qsa/verify";
import { normalizarUf } from "@/lib/uf";

const sb = (c: { db: unknown }) => c.db as SupabaseClient;

const COLUNAS =
  "id,user_id,nome_fantasia,cidade,uf,bairro,cnpj,telefone_1,telefone_2,proprietario,email,razao_social,capital_social,data_abertura,qsa,enrichment_status";

async function carregarLead(c: { db: unknown; userId: string; params: Record<string, string> }): Promise<LeadQsaRow> {
  if (!z.string().uuid().safeParse(c.params.id).success) throw erros.invalido("ID de lead inválido.");
  const { data, error } = await sb(c).from("leads").select(COLUNAS).eq("id", c.params.id).eq("user_id", c.userId).maybeSingle();
  if (error) throw erros.interno(error.message);
  if (!data) throw erros.naoEncontrado("Lead");
  return data as unknown as LeadQsaRow;
}

/** GET /leads/:id/qsa — laudo já gravado, sem consultar nada. */
export const laudoDoLead = protegido(async (c) => {
  const lead = await carregarLead(c);
  return ok({
    lead_id: lead.id,
    status: lead.enrichment_status,
    proprietario: lead.proprietario,
    laudo: lead.qsa ?? null,
  });
});

const consultaVerificar = z.object({
  simular: z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1").optional(),
  web: z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1").optional(),
});

/** POST /leads/:id/qsa — (re)verifica o lead. `?simular=true` mostra o resultado sem gravar. */
export const verificarLead = protegido(async (c) => {
  const lead = await carregarLead(c);
  const { simular, web } = lerQuery(c.request, consultaVerificar);
  if (simular) {
    const resultado = await verificarLeadRow(lead, c.origin, { web });
    return ok({ resultado, seria_gravado: montarAtualizacaoLead(lead, resultado) }, { simulado: true });
  }
  const { resultado, atualizacao } = await verificarEGravar(c.db, lead, c.origin, { web });
  return ok({ resultado, gravado: atualizacao });
});

/** GET /qsa/:cnpj — consulta livre de um CNPJ (base local, depois fontes gratuitas). */
const consultaCnpj = z.object({
  uf: z.string().trim().max(20).optional(),
  nome: z.string().trim().max(200).optional(),
  cidade: z.string().trim().max(120).optional(),
});

export const consultarCnpj = protegido(async (c) => {
  const cnpj = soDigitos(c.params.cnpj);
  if (!cnpjValido(cnpj)) throw erros.invalido("CNPJ inválido (dígitos verificadores).");
  const q = lerQuery(c.request, consultaCnpj);
  const resultado = await resolverQsa(
    { cnpj, uf: normalizarUf(q.uf), nomeFantasia: q.nome ?? null, cidade: q.cidade ?? null },
    { base: baseLocalPara(c.origin) },
  );
  return ok(resultado);
});

/** POST /qsa/resolver — descobre empresa e decisor a partir de nome + cidade, sem lead. */
const corpoResolver = z.object({
  nome_fantasia: z.string().trim().min(2).max(200),
  cidade: z.string().trim().min(2).max(120),
  uf: z.string().trim().min(2).max(20),
  bairro: z.string().trim().max(120).nullish(),
  telefone: z.string().trim().max(30).nullish(),
  busca_web: z.boolean().default(true),
});

export const resolverPorNome = protegido(async (c) => {
  const b = await lerCorpo(c.request, corpoResolver);
  const uf = normalizarUf(b.uf);
  if (!uf) throw erros.invalido("UF inválida.");
  const resultado = await resolverQsa(
    { nomeFantasia: b.nome_fantasia, cidade: b.cidade, uf, bairro: b.bairro ?? null, telefone1: b.telefone ?? null },
    { base: baseLocalPara(c.origin), buscarCnpjPorTexto: b.busca_web ? buscarCnpjPorTexto : undefined },
  );
  return ok(resultado);
});
