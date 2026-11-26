import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "@/lib/api/auth.server";
import { erros } from "@/lib/api/errors";
import { processarPendentes, type ResumoLote } from "@/lib/qsa/pipeline.server";
import { normalizarUf, separarCidadeUf } from "@/lib/uf";

const ACTOR = "compass~crawler-google-places";

function token(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw erros.config("APIFY_TOKEN não configurado.");
  return t;
}

const norm = (s?: string | null) =>
  (s ?? "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

type Run = { id: string; status: string; defaultDatasetId: string };

async function apify<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export async function iniciarJob(
  db: Db,
  userId: string,
  entrada: { cidade: string; nicho: string; maximo?: number },
) {
  const t = token();
  const sb = db as unknown as SupabaseClient;

  // Jobs parados há mais de 10 min não podem bloquear novos.
  await sb
    .from("enrichment_jobs")
    .update({ status: "failed", error: "abandoned (stale)" })
    .eq("user_id", userId)
    .in("status", ["queued", "running"])
    .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());

  const { data: job, error } = await sb
    .from("enrichment_jobs")
    .insert({ user_id: userId, city: entrada.cidade, niche: entrada.nicho, status: "queued", progress: 0 })
    .select("id")
    .single();
  if (error || !job) throw new Error(error?.message ?? "Falha ao criar o job.");

  try {
    const { data } = await apify<{ data: Run }>(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${t}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        searchStringsArray: [entrada.nicho],
        locationQuery: `${entrada.cidade}, Brasil`,
        maxCrawledPlacesPerSearch: entrada.maximo ?? 40,
        language: "pt-BR",
        countryCode: "br",
      }),
    });
    await sb.from("enrichment_jobs").update({ status: "running", apify_run_id: data.id, progress: 10 }).eq("id", job.id);
    return { job_id: job.id as string, apify_run_id: data.id };
  } catch (e) {
    await sb.from("enrichment_jobs").update({ status: "failed", error: String((e as Error).message) }).eq("id", job.id);
    throw e;
  }
}

const EH_AUTOESCOLA = (p: any) => {
  const cats = [p.categoryName, ...(Array.isArray(p.categories) ? p.categories : [])]
    .filter(Boolean)
    .map((c: unknown) => String(c).toLowerCase());
  const titulo = String(p.title ?? p.name ?? "").toLowerCase();
  const porCategoria = cats.some(
    (c) =>
      c.includes("driving school") ||
      c.includes("autoescola") ||
      c.includes("auto escola") ||
      c.includes("auto-escola") ||
      c.includes("centro de formação") ||
      c.includes("centro de formacao"),
  );
  return porCategoria || /\bauto[\s-]*escola\b|\bcfc\b|centro de forma[cç][ãa]o/i.test(titulo);
};

export type ResultadoSync = {
  status: "queued" | "running" | "done" | "failed";
  progresso: number;
  leads_criados?: number;
  duplicados?: number;
  rejeitados_categoria?: number;
  rejeitados_fechados?: number;
  qsa?: ResumoLote;
  erro?: string | null;
};

/**
 * Consulta o run no Apify; quando termina, grava os leads, descarta duplicados e
 * já dispara a verificação de QSA deles. Seguro de chamar várias vezes: um job
 * `done` ou `failed` devolve o que já tem.
 */
export async function sincronizarJob(db: Db, userId: string, jobId: string, origem: string): Promise<ResultadoSync> {
  const sb = db as unknown as SupabaseClient;
  const { data: job, error } = await sb.from("enrichment_jobs").select("*").eq("id", jobId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw erros.naoEncontrado("Job");

  if (job.status === "done") return { status: "done", progresso: 100, leads_criados: job.leads_created };
  if (job.status === "failed") return { status: "failed", progresso: job.progress ?? 0, erro: job.error };
  if (!job.apify_run_id) return { status: job.status, progresso: job.progress ?? 0 };

  const t = token();
  const { data: run } = await apify<{ data: Run }>(`https://api.apify.com/v2/actor-runs/${job.apify_run_id}?token=${t}`);

  if (run.status === "RUNNING" || run.status === "READY") {
    const progresso = Math.min(80, (job.progress ?? 10) + 5);
    await sb.from("enrichment_jobs").update({ progress: progresso }).eq("id", job.id);
    return { status: "running", progresso };
  }
  if (run.status !== "SUCCEEDED") {
    await sb.from("enrichment_jobs").update({ status: "failed", error: `Apify ${run.status}` }).eq("id", job.id);
    return { status: "failed", progresso: job.progress ?? 0, erro: `Apify ${run.status}` };
  }

  // Trava otimista: dois pollers simultâneos não podem ingerir o mesmo run duas vezes.
  const { data: travado } = await sb
    .from("enrichment_jobs")
    .update({ progress: 90 })
    .eq("id", job.id)
    .eq("status", "running")
    .select("id");
  if (!travado?.length) return { status: "running", progresso: 90 };

  const itens = await apify<any[]>(
    `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${t}&clean=true&limit=500`,
  );

  const { cidade: cidadeAlvo } = separarCidadeUf(job.city);
  const alvo = norm(cidadeAlvo);
  const naCidade = itens.filter((p) => {
    const c = norm(p.city ?? p.address ?? "");
    return alvo && (c === alvo || c.includes(alvo));
  });
  const abertos = naCidade.filter((p) => !p.permanentlyClosed && !p.temporarilyClosed);
  const nicheAutoescola = /autoescola|auto\s*escola|cfc|driving/i.test(job.niche ?? "");
  const filtrados = nicheAutoescola ? abertos.filter(EH_AUTOESCOLA) : abertos;

  const linhas = filtrados
    .map((p) => ({
      user_id: userId,
      source: "apify_gmaps",
      enrichment_job_id: job.id,
      status: "new",
      pipeline_stage: "activate",
      nome_fantasia: p.title ?? p.name ?? null,
      telefone_1: p.phone ?? p.phoneUnformatted ?? null,
      endereco: p.address ?? null,
      bairro: p.neighborhood ?? null,
      cidade: p.city ?? cidadeAlvo,
      uf: normalizarUf(p.state) ?? p.state ?? separarCidadeUf(job.city).uf ?? null,
      website: p.website ?? null,
      google_rating: p.totalScore ?? null,
      google_reviews: p.reviewsCount ?? null,
      opening_hours: p.openingHours ?? null,
      google_meu_negocio: p.url ?? (p.placeId ? `https://www.google.com/maps/place/?q=place_id:${p.placeId}` : null),
    }))
    .filter((r) => r.nome_fantasia);

  // Duplicados: mesmo telefone ou mesmo link do Maps que o usuário já tem.
  const telefones = linhas.map((l) => l.telefone_1).filter(Boolean) as string[];
  const links = linhas.map((l) => l.google_meu_negocio).filter(Boolean) as string[];
  const existentes = new Set<string>();
  if (telefones.length) {
    const { data } = await sb.from("leads").select("telefone_1").eq("user_id", userId).in("telefone_1", telefones);
    for (const r of data ?? []) existentes.add(`t:${r.telefone_1}`);
  }
  if (links.length) {
    const { data } = await sb.from("leads").select("google_meu_negocio").eq("user_id", userId).in("google_meu_negocio", links);
    for (const r of data ?? []) existentes.add(`g:${r.google_meu_negocio}`);
  }
  const novas = linhas.filter(
    (l) => !(l.telefone_1 && existentes.has(`t:${l.telefone_1}`)) && !(l.google_meu_negocio && existentes.has(`g:${l.google_meu_negocio}`)),
  );

  let ids: string[] = [];
  if (novas.length) {
    const { data: inseridos, error: ie } = await sb.from("leads").insert(novas).select("id");
    if (ie && !String(ie.message).includes("duplicate")) {
      await sb.from("enrichment_jobs").update({ status: "failed", error: ie.message }).eq("id", job.id);
      throw new Error(ie.message);
    }
    ids = (inseridos ?? []).map((r: { id: string }) => r.id);
  }

  await sb.from("enrichment_jobs").update({ status: "done", progress: 100, leads_created: ids.length }).eq("id", job.id);

  // Verificação do QSA logo na entrada: o lead já chega ao painel com decisor.
  let qsa: ResumoLote | undefined;
  if (ids.length) qsa = await processarPendentes(db, origem, { userId, leadIds: ids, orcamentoMs: 15_000 });

  return {
    status: "done",
    progresso: 100,
    leads_criados: ids.length,
    duplicados: linhas.length - novas.length,
    rejeitados_categoria: abertos.length - filtrados.length,
    rejeitados_fechados: naCidade.length - abertos.length,
    qsa,
  };
}
