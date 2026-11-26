import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { protegido } from "../handler.server";
import { erros } from "../errors";
import { lerCorpo, lerQuery, likeSeguro, metaPaginacao, ok, paginacao, qBool } from "../http";
import { processarPendentes } from "@/lib/qsa/pipeline.server";
import { cnpjValido, soDigitos } from "@/lib/qsa/verify";
import { normalizarUf } from "@/lib/uf";

const sb = (c: { db: unknown }) => c.db as SupabaseClient;

const texto = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

const uf = z
  .string()
  .trim()
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    const u = normalizarUf(v);
    if (!u) ctx.addIssue({ code: "custom", message: "UF inválida." });
    return u;
  });

const cnpj = z
  .string()
  .trim()
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = soDigitos(v);
    if (!cnpjValido(d)) ctx.addIssue({ code: "custom", message: "CNPJ inválido (dígitos verificadores)." });
    return d;
  });

export const camposLead = {
  nome_fantasia: z.string().trim().min(1).max(200),
  razao_social: texto(250),
  telefone_1: texto(30),
  telefone_2: texto(30),
  whatsapp: texto(30),
  cidade: texto(120),
  uf,
  bairro: texto(120),
  endereco: texto(300),
  website: texto(300),
  email: z.string().trim().email().max(200).nullish().transform((v) => v || null),
  cnpj,
  capital_social: z.number().nonnegative().nullish().transform((v) => v ?? null),
  data_abertura: z.string().date().nullish().transform((v) => v ?? null),
  proprietario: texto(200),
  notas: texto(5000),
};

const leadCriacao = z.object({ ...camposLead, source: z.string().trim().max(40).default("api") });

const corpoLote = z.object({
  leads: z.array(leadCriacao).min(1).max(500),
  enriquecer: z.boolean().default(true),
});
const corpoUnico = leadCriacao.extend({ enriquecer: z.boolean().default(true) });

const STATUS = ["new", "no_answer", "gatekeeper", "not_interested", "callback", "meeting_scheduled"] as const;
const ESTAGIOS = ["activate", "in_contact", "scheduled", "dismissed"] as const;
const iso = z.string().datetime({ offset: true }).nullish();

const corpoAtualizacao = z
  .object(camposLead)
  .extend({
    status: z.enum(STATUS),
    pipeline_stage: z.enum(ESTAGIOS),
    nome_ponte: texto(200),
    followup_at: iso,
    followup_notes: texto(2000),
    retorno_agendado_em: iso,
    meeting_at: iso,
    meeting_link: texto(500),
    meeting_status: z.enum(["scheduled", "held", "no_show", "rescheduled"]).nullish(),
    meeting_result: texto(2000),
    closer_notes: texto(5000),
  })
  .partial()
  .strict();

const consulta = paginacao.extend({
  q: z.string().trim().max(100).optional(),
  cidade: z.string().trim().max(120).optional(),
  uf: z.string().trim().max(2).optional(),
  status: z.string().trim().max(200).optional(), // lista separada por vírgula
  etapa: z.string().trim().max(200).optional(),
  enriquecimento: z.string().trim().max(200).optional(),
  com_decisor: qBool,
  com_telefone: qBool,
  retorno_vencido: qBool,
  com_followup: qBool,
  ordem: z.enum(["created_at", "updated_at", "last_call_at", "nome_fantasia", "followup_at"]).default("created_at"),
  direcao: z.enum(["asc", "desc"]).default("desc"),
});

const lista = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

export const listar = protegido(async (c) => {
  const f = lerQuery(c.request, consulta);
  let q = sb(c).from("leads").select("*", { count: "exact" }).eq("user_id", c.userId);

  if (f.cidade) q = q.ilike("cidade", likeSeguro(f.cidade));
  if (f.uf) q = q.eq("uf", f.uf.toUpperCase());
  if (lista(f.status).length) q = q.in("status", lista(f.status));
  if (lista(f.etapa).length) q = q.in("pipeline_stage", lista(f.etapa));
  if (lista(f.enriquecimento).length) {
    const vals = lista(f.enriquecimento);
    const reais = vals.filter((v) => v !== "pendente");
    const conds: string[] = [];
    if (vals.includes("pendente")) conds.push("enrichment_status.is.null");
    if (reais.length) conds.push(`enrichment_status.in.(${reais.map((v) => v.replace(/[^a-z_]/gi, "")).join(",")})`);
    q = q.or(conds.join(","));
  }
  if (f.com_decisor === true) q = q.not("proprietario", "is", null);
  if (f.com_decisor === false) q = q.is("proprietario", null);
  if (f.com_telefone === true) q = q.not("telefone_1", "is", null);
  if (f.com_followup === true) q = q.not("followup_at", "is", null);
  if (f.retorno_vencido === true) q = q.not("retorno_agendado_em", "is", null).lte("retorno_agendado_em", new Date().toISOString());
  if (f.q) {
    const t = likeSeguro(f.q);
    q = q.or(
      `nome_fantasia.ilike.%${t}%,razao_social.ilike.%${t}%,proprietario.ilike.%${t}%,cnpj.ilike.%${t}%,telefone_1.ilike.%${t}%,bairro.ilike.%${t}%`,
    );
  }

  const de = (f.page - 1) * f.limit;
  const { data, count, error } = await q
    .order(f.ordem, { ascending: f.direcao === "asc", nullsFirst: false })
    .range(de, de + f.limit - 1);
  if (error) throw erros.interno(error.message);
  return ok(data ?? [], metaPaginacao(count, f.limit, f.page));
});

const LIMITE_ENRIQUECER_NA_HORA = 40;

export const criar = protegido(async (c) => {
  const bruto = await lerCorpo(c.request, z.object({}).passthrough());
  const lote = "leads" in bruto;
  const { entradas, enriquecer } = lote
    ? (({ leads, enriquecer }) => ({ entradas: leads, enriquecer }))(corpoLote.parse(bruto))
    : (({ enriquecer, ...lead }) => ({ entradas: [lead], enriquecer }))(corpoUnico.parse(bruto));

  // Duplicados: mesmo CNPJ ou mesmo telefone que o usuário já tem (ou repetido no próprio lote).
  const cnpjs = [...new Set(entradas.map((l) => l.cnpj).filter(Boolean))] as string[];
  const fones = [...new Set(entradas.map((l) => l.telefone_1).filter(Boolean))] as string[];
  const ja = new Set<string>();
  if (cnpjs.length) {
    const { data } = await sb(c).from("leads").select("cnpj").eq("user_id", c.userId).in("cnpj", cnpjs);
    for (const r of data ?? []) ja.add(`c:${r.cnpj}`);
  }
  if (fones.length) {
    const { data } = await sb(c).from("leads").select("telefone_1").eq("user_id", c.userId).in("telefone_1", fones);
    for (const r of data ?? []) ja.add(`t:${r.telefone_1}`);
  }

  const novos: typeof entradas = [];
  const duplicados: { nome_fantasia: string; motivo: string }[] = [];
  for (const l of entradas) {
    const kc = l.cnpj ? `c:${l.cnpj}` : null;
    const kt = l.telefone_1 ? `t:${l.telefone_1}` : null;
    const motivo = kc && ja.has(kc) ? "cnpj já cadastrado" : kt && ja.has(kt) ? "telefone já cadastrado" : null;
    if (motivo) {
      duplicados.push({ nome_fantasia: l.nome_fantasia, motivo });
      continue;
    }
    if (kc) ja.add(kc);
    if (kt) ja.add(kt);
    novos.push(l);
  }

  let criados: { id: string }[] = [];
  if (novos.length) {
    const { data, error } = await sb(c)
      .from("leads")
      .insert(novos.map((l) => ({ ...l, user_id: c.userId, status: "new", pipeline_stage: "activate" })))
      .select("id");
    if (error) throw erros.interno(error.message);
    criados = data ?? [];
  }

  let qsa;
  if (enriquecer && criados.length) {
    const agora = criados.slice(0, LIMITE_ENRIQUECER_NA_HORA).map((r) => r.id);
    qsa = await processarPendentes(c.db, c.origin, { userId: c.userId, leadIds: agora, orcamentoMs: 12_000 });
  }

  let leads: unknown[] = [];
  if (criados.length) {
    const { data } = await sb(c).from("leads").select("*").in("id", criados.map((r) => r.id));
    leads = data ?? [];
  }
  return ok(
    lote ? leads : leads[0] ?? null,
    {
      criados: criados.length,
      duplicados,
      qsa,
      pendentes_para_rotina: Math.max(0, criados.length - LIMITE_ENRIQUECER_NA_HORA),
    },
    201,
  );
});

function idDe(c: { params: Record<string, string> }): string {
  const id = c.params.id;
  if (!z.string().uuid().safeParse(id).success) throw erros.invalido("ID de lead inválido.");
  return id;
}

export const obter = protegido(async (c) => {
  const { data, error } = await sb(c).from("leads").select("*").eq("id", idDe(c)).eq("user_id", c.userId).maybeSingle();
  if (error) throw erros.interno(error.message);
  if (!data) throw erros.naoEncontrado("Lead");
  return ok(data);
});

export const atualizar = protegido(async (c) => {
  const id = idDe(c);
  const corpo = await lerCorpo(c.request, corpoAtualizacao);
  if (!Object.keys(corpo).length) throw erros.invalido("Envie ao menos um campo para atualizar.");
  const { data, error } = await sb(c)
    .from("leads")
    .update(corpo)
    .eq("id", id)
    .eq("user_id", c.userId)
    .select("*")
    .maybeSingle();
  if (error) throw erros.interno(error.message);
  if (!data) throw erros.naoEncontrado("Lead");
  return ok(data);
});

export const remover = protegido(async (c) => {
  const id = idDe(c);
  // call_logs.lead_id é ON DELETE SET NULL: o histórico sobrevive, só perde o vínculo.
  const { data, error } = await sb(c).from("leads").delete().eq("id", id).eq("user_id", c.userId).select("id");
  if (error) throw erros.interno(error.message);
  if (!data?.length) throw erros.naoEncontrado("Lead");
  return ok({ id, removido: true });
});
