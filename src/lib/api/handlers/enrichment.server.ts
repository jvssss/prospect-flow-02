import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { protegido } from "../handler.server";
import { erros } from "../errors";
import { lerCorpo, lerQuery, ok, qInt } from "../http";
import { iniciarJob, sincronizarJob } from "@/lib/enrichment/apify.server";
import { processarPendentes } from "@/lib/qsa/pipeline.server";

const sb = (c: { db: unknown }) => c.db as SupabaseClient;

const corpoJob = z.object({
  cidade: z.string().trim().min(2).max(120),
  nicho: z.string().trim().min(2).max(80).default("Autoescola"),
  maximo: z.number().int().min(5).max(200).default(40),
});

/** POST /enrichment/jobs — "Adquirir mais leads": busca no Google Maps pela cidade. */
export const criarJob = protegido(
  async (c) => {
    const b = await lerCorpo(c.request, corpoJob);
    const r = await iniciarJob(c.db, c.userId, { cidade: b.cidade, nicho: b.nicho, maximo: b.maximo });
    return ok(r, { proximo_passo: `GET /enrichment/jobs/${r.job_id} até status "done" (ou deixe a rotina /cron/enrich fazer).` }, 202);
  },
  { limitePorMinuto: 20 },
);

const consultaLista = z.object({ limit: qInt(20, 1, 100) });

export const listarJobs = protegido(async (c) => {
  const { limit } = lerQuery(c.request, consultaLista);
  const { data, error } = await sb(c)
    .from("enrichment_jobs")
    .select("*")
    .eq("user_id", c.userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw erros.interno(error.message);
  return ok(data ?? []);
});

/** GET /enrichment/jobs/:id — consulta e, quando o Apify termina, ingere e verifica o QSA. */
export const obterJob = protegido(async (c) => {
  if (!z.string().uuid().safeParse(c.params.id).success) throw erros.invalido("ID de job inválido.");
  const r = await sincronizarJob(c.db, c.userId, c.params.id, c.origin);
  return ok(r);
});

const corpoLote = z.object({
  limite: z.number().int().min(1).max(500).default(100),
  lead_ids: z.array(z.string().uuid()).max(500).optional(),
});

/**
 * POST /enrichment/qsa — verifica o QSA dos leads pendentes (ou dos ids enviados).
 * Chame de novo enquanto `restantes` for maior que zero.
 */
export const verificarPendentes = protegido(
  async (c) => {
    const b = await lerCorpo(c.request, corpoLote);
    const r = await processarPendentes(c.db, c.origin, {
      userId: c.userId,
      limite: b.limite,
      leadIds: b.lead_ids,
      orcamentoMs: 20_000,
    });
    return ok(r);
  },
  { limitePorMinuto: 30 },
);

/** GET /enrichment/stats — quantos leads em cada situação de verificação. */
export const estatisticas = protegido(async (c) => {
  const contar = async (filtro: (q: any) => any) => {
    const { count, error } = await filtro(
      sb(c).from("leads").select("id", { count: "exact", head: true }).eq("user_id", c.userId),
    );
    if (error) throw erros.interno(error.message);
    return count ?? 0;
  };
  const [total, pendentes, retry, enriquecidos, inativos, nao_encontrados, com_decisor] = await Promise.all([
    contar((q) => q),
    contar((q) => q.is("enrichment_status", null)),
    contar((q) => q.eq("enrichment_status", "retry")),
    contar((q) => q.eq("enrichment_status", "enriched")),
    contar((q) => q.eq("enrichment_status", "inactive")),
    contar((q) => q.eq("enrichment_status", "not_found")),
    contar((q) => q.not("proprietario", "is", null)),
  ]);
  return ok({
    total,
    pendentes,
    tentar_novamente: retry,
    enriquecidos,
    inativos,
    nao_encontrados,
    com_decisor,
    taxa_decisor: total > 0 ? com_decisor / total : null,
  });
});
