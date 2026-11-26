import type { SupabaseClient } from "@supabase/supabase-js";
import { clienteAdmin } from "../auth.server";
import { agendado, publico } from "../handler.server";
import { json, ok } from "../http";
import { sincronizarJob } from "@/lib/enrichment/apify.server";
import { processarPendentes } from "@/lib/qsa/pipeline.server";
import { openapi } from "../openapi";

async function infoBase(origem: string) {
  const url = `${process.env.RFB_BASE_URL?.trim() || origem}/rfb/_index.json`.replace(/([^:])\/\//g, "$1/");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { carregada: false, motivo: `HTTP ${res.status} em ${url}` };
    const j = (await res.json()) as { mes: string; total: number; ufs: Record<string, number> };
    return { carregada: true, mes: j.mes, autoescolas: j.total, ufs: Object.keys(j.ufs).length };
  } catch (e) {
    return { carregada: false, motivo: String((e as Error).message ?? e).slice(0, 100) };
  }
}

/** GET /api/health — sem autenticação; diz o que está configurado, nunca os valores. */
export const saude = publico(async ({ request }) => {
  const origem = new URL(request.url).origin;
  const env = process.env;
  const base = await infoBase(origem);
  const configurado = {
    supabase: !!(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY),
    service_role: !!env.SUPABASE_SERVICE_ROLE_KEY,
    apify: !!env.APIFY_TOKEN,
    cron_secret: !!env.CRON_SECRET,
    cnpja_paga: !!env.CNPJA_API_KEY,
  };
  const problemas: string[] = [];
  if (!configurado.supabase) problemas.push("Supabase não configurado.");
  if (!configurado.service_role) problemas.push("SUPABASE_SERVICE_ROLE_KEY ausente: chaves de API e cron não funcionam.");
  if (!configurado.cron_secret) problemas.push("CRON_SECRET ausente: a rotina automática fica desligada.");
  if (!configurado.apify) problemas.push("APIFY_TOKEN ausente: 'Adquirir mais leads' não funciona.");
  if (!base.carregada) problemas.push("Base local da Receita não encontrada em /rfb: o QSA depende de fontes externas.");
  return json({ status: problemas.length ? "atencao" : "ok", versao: "1.0.0", configurado, base_local: base, problemas });
});

export const especificacao = publico(async ({ request }) => json(openapi(new URL(request.url).origin)));

export const documentacao = publico(async () =>
  new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prospect Flow API</title><style>body{margin:0}</style></head><body><redoc spec-url="/api/v1/openapi"></redoc><script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  ),
);

/**
 * Rotina automática (agendador chama de tempos em tempos):
 *   1. conclui os jobs do Apify que estavam rodando e cria os leads;
 *   2. verifica o QSA dos leads pendentes, de todos os usuários.
 * Responde rápido e é segura para chamar repetidas vezes.
 */
export const rotinaEnriquecer = agendado(async ({ request }) => {
  const origem = new URL(request.url).origin;
  const db = await clienteAdmin();
  const sb = db as unknown as SupabaseClient;

  const jobs: { id: string; status: string; erro?: string }[] = [];
  const { data: ativos } = await sb
    .from("enrichment_jobs")
    .select("id,user_id")
    .eq("status", "running")
    .gte("updated_at", new Date(Date.now() - 2 * 3600_000).toISOString())
    .limit(20);
  for (const j of ativos ?? []) {
    try {
      const r = await sincronizarJob(db, j.user_id, j.id, origem);
      jobs.push({ id: j.id, status: r.status });
    } catch (e) {
      jobs.push({ id: j.id, status: "erro", erro: String((e as Error).message).slice(0, 120) });
    }
  }

  const qsa = await processarPendentes(db, origem, { limite: 200, orcamentoMs: 20_000, concorrencia: 8 });
  return ok({ jobs, qsa });
});
