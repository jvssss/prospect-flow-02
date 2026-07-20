import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// =====================================================================
// CNPJ enrichment
//   - Primary: CNPJ.biz (search by name+cidade+uf, detail with QSA)
//   - Fallback: publica.cnpj.ws (grátis, quando já temos CNPJ)
// =====================================================================

const CNPJ_BIZ_BASE = "https://cnpj.biz/api/v2";

async function cnpjBizPost(path: string, body: unknown) {
  const token = process.env.CNPJ_BIZ_TOKEN;
  if (!token) throw new Error("CNPJ_BIZ_TOKEN não configurado");
  const res = await fetch(`${CNPJ_BIZ_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`cnpj.biz ${path} ${res.status}`);
  return res.json();
}

/** Busca CNPJ.biz por nome fantasia + cidade/UF; retorna primeiro payload completo ou null. */
async function cnpjBizSearchByName(name: string, cidade?: string | null, uf?: string | null) {
  if (!name) return null;
  const clean = name.replace(/[^\p{L}\p{N}\s&-]/gu, "").trim();
  if (!clean) return null;
  const localidades: any[] = [];
  if (cidade && uf) localidades.push({ tipo: "cidade", cidade, estado: uf, pais: "BR" });
  else if (uf) localidades.push({ tipo: "estado", estado: uf, pais: "BR" });
  try {
    const rows = await cnpjBizPost("/empresas/listar-com-dados", {
      razao_fantasia: [clean],
      localidades,
      limit: 3,
      offset: 0,
    });
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  } catch {
    return null;
  }
}

/** Detalhe completo por CNPJ (inclui QSA/socios). */
async function cnpjBizFetchDetail(cnpj: string) {
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) throw new Error("CNPJ inválido");
  return cnpjBizPost("/empresas/cnpj", { cnpj: clean, filial: false });
}

/** Fallback público (sem custo) — usado só quando cnpj.biz falha. */
async function fetchCnpjDataPublic(cnpj: string) {
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) throw new Error("CNPJ inválido");
  const res = await fetch(`https://publica.cnpj.ws/cnpj/${clean}`, {
    headers: { accept: "application/json" },
  });
  if (res.status === 429) throw new Error("Limite de consultas atingido, tente em instantes");
  if (!res.ok) throw new Error(`CNPJ API ${res.status}`);
  return res.json() as Promise<any>;
}

/** Payload cnpj.biz (formato /empresas/cnpj) → row parcial de lead. */
function mapCnpjBizDetail(p: any) {
  if (!p) return null;
  const end = p.endereco ?? {};
  const tels: string[] = Array.isArray(p.telefones)
    ? p.telefones.map((t: any) => (typeof t === "string" ? t : t?.telefone)).filter(Boolean)
    : [];
  const socios = Array.isArray(p.socios)
    ? p.socios.filter((s: any) => s && (typeof s === "string" ? s.trim() : s.nome))
    : null;
  return {
    cnpj: p.cnpj ?? null,
    razao_social: p.razao_social ?? null,
    nome_fantasia: p.nome_fantasia ?? null,
    capital_social: p.capital_social ? Number(p.capital_social) : null,
    data_abertura: p.data_abertura ?? null,
    bairro: end?.bairro ?? null,
    cidade: end?.cidade?.nome ?? null,
    uf: end?.estado?.sigla ?? null,
    endereco: [end?.tipo_logradouro, end?.logradouro, end?.numero].filter(Boolean).join(" ") || null,
    telefone_1: tels[0] ?? null,
    telefone_2: tels[1] ?? null,
    email: p.email ?? null,
    socios: socios && socios.length ? socios : null,
    proprietario: socios?.[0]?.nome ?? (typeof socios?.[0] === "string" ? socios[0] : null) ?? null,
  };
}

/** Payload publica.cnpj.ws → row parcial (fallback). */
function mapPublicCnpj(payload: any) {
  const est = payload?.estabelecimento ?? {};
  const tel1 = est?.ddd1 && est?.telefone1 ? `${est.ddd1}${est.telefone1}` : null;
  const tel2 = est?.ddd2 && est?.telefone2 ? `${est.ddd2}${est.telefone2}` : null;
  const socios = Array.isArray(payload?.socios) ? payload.socios : null;
  return {
    razao_social: payload?.razao_social ?? null,
    nome_fantasia: est?.nome_fantasia ?? null,
    capital_social: payload?.capital_social ? Number(payload.capital_social) : null,
    data_abertura: est?.data_inicio_atividade ?? null,
    bairro: est?.bairro ?? null,
    cidade: est?.cidade?.nome ?? null,
    uf: est?.estado?.sigla ?? null,
    endereco: [est?.tipo_logradouro, est?.logradouro, est?.numero].filter(Boolean).join(" ") || null,
    telefone_1: tel1,
    telefone_2: tel2,
    email: est?.email ?? null,
    socios,
    proprietario: socios?.[0]?.nome ?? socios?.[0]?.nome_socio ?? null,
  };
}

/** Enriquecimento completo a partir de um CNPJ conhecido (cnpj.biz → fallback público). */
async function enrichByCnpj(cnpj: string) {
  try {
    const detail = await cnpjBizFetchDetail(cnpj);
    const mapped = mapCnpjBizDetail(detail);
    if (mapped) return mapped;
  } catch { /* fallback abaixo */ }
  try {
    const payload = await fetchCnpjDataPublic(cnpj);
    return mapPublicCnpj(payload);
  } catch { return null; }
}

/** Concorrência limitada para não sobrecarregar as APIs. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx]); }
        catch { out[idx] = undefined as any; }
      }
    }),
  );
  return out;
}

export const enrichLeadCnpj = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: lead, error } = await supabase
      .from("leads").select("id, cnpj").eq("id", data.leadId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!lead?.cnpj) throw new Error("Lead sem CNPJ para enriquecer");
    const mapped = await enrichByCnpj(lead.cnpj);
    if (!mapped) throw new Error("Não foi possível enriquecer este CNPJ");
    const { cnpj: _c, ...updates } = mapped as any;
    const { error: upErr } = await supabase.from("leads").update(updates).eq("id", lead.id);
    if (upErr) throw upErr;
    return { ok: true, mapped };
  });

// ---------- Apify Google Maps scraping ----------

const APIFY_ACTOR = "compass~crawler-google-places";

async function apifyStartRun(input: unknown) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN não configurado");
  const res = await fetch(
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs?token=${token}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
  );
  if (!res.ok) throw new Error(`Apify start failed: ${res.status} ${await res.text()}`);
  return (await res.json()).data as { id: string; status: string; defaultDatasetId: string };
}

async function apifyGetRun(runId: string) {
  const token = process.env.APIFY_TOKEN!;
  const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
  if (!res.ok) throw new Error(`Apify status failed: ${res.status}`);
  return (await res.json()).data as { id: string; status: string; defaultDatasetId: string };
}

async function apifyGetItems(datasetId: string): Promise<any[]> {
  const token = process.env.APIFY_TOKEN!;
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true&limit=500`,
  );
  if (!res.ok) throw new Error(`Apify dataset failed: ${res.status}`);
  return res.json();
}

export const startEnrichmentJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      city: z.string().min(2),
      niche: z.string().min(2),
      maxResults: z.number().int().min(5).max(200).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: job, error: jerr } = await supabase.from("enrichment_jobs").insert({
      user_id: userId, city: data.city, niche: data.niche, status: "queued", progress: 0,
    }).select("id").single();
    if (jerr) throw jerr;

    try {
      const run = await apifyStartRun({
        searchStringsArray: [`${data.niche} ${data.city}`],
        maxCrawledPlacesPerSearch: data.maxResults ?? 40,
        language: "pt-BR",
        countryCode: "br",
      });
      await supabase.from("enrichment_jobs")
        .update({ status: "running", apify_run_id: run.id, progress: 10 })
        .eq("id", job.id);
      return { jobId: job.id, runId: run.id };
    } catch (e: any) {
      await supabase.from("enrichment_jobs")
        .update({ status: "failed", error: String(e?.message ?? e) }).eq("id", job.id);
      throw e;
    }
  });

export const syncEnrichmentJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: job, error } = await supabase
      .from("enrichment_jobs").select("*").eq("id", data.jobId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!job) throw new Error("Job não encontrado");
    if (job.status === "done" || job.status === "failed") return job;
    if (!job.apify_run_id) return job;

    const run = await apifyGetRun(job.apify_run_id);
    if (run.status === "RUNNING" || run.status === "READY") {
      await supabase.from("enrichment_jobs").update({ progress: Math.min(80, (job.progress ?? 10) + 5) }).eq("id", job.id);
      return { ...job, status: "running" };
    }
    if (run.status !== "SUCCEEDED") {
      await supabase.from("enrichment_jobs").update({ status: "failed", error: `Apify ${run.status}` }).eq("id", job.id);
      return { ...job, status: "failed" };
    }

    // Ingestion
    const items = await apifyGetItems(run.defaultDatasetId);
    const baseRows = items.map((p: any) => ({
      user_id: userId,
      source: "apify_gmaps",
      enrichment_job_id: job.id,
      status: "new",
      pipeline_stage: "activate",
      nome_fantasia: p.title ?? p.name ?? null,
      telefone_1: p.phone ?? p.phoneUnformatted ?? null,
      whatsapp: null,
      endereco: p.address ?? null,
      bairro: p.neighborhood ?? null,
      cidade: p.city ?? job.city,
      uf: p.state ?? null,
      website: p.website ?? null,
      google_rating: p.totalScore ?? null,
      google_reviews: p.reviewsCount ?? null,
      cnpj: null as string | null,
    })).filter((r) => r.nome_fantasia);

    // Passo 2/3: cruzamento com CNPJ.biz por nome + cidade → QSA + capital + dados oficiais.
    // Fallback de segurança: se não achar CNPJ, mantém dados do Maps (proprietário = null).
    const enrichedRows = await mapWithConcurrency(baseRows, 5, async (row) => {
      try {
        const hit = await cnpjBizSearchByName(row.nome_fantasia!, row.cidade, row.uf);
        if (!hit?.cnpj) return row;
        const detail = await enrichByCnpj(hit.cnpj);
        if (!detail) return { ...row, cnpj: hit.cnpj };
        // Preserva dados locais do Maps (avaliações, site, telefones se CNPJ não trouxe).
        return {
          ...row,
          ...Object.fromEntries(Object.entries(detail).filter(([, v]) => v != null && v !== "")),
          website: row.website ?? (detail as any).website ?? null,
          google_rating: row.google_rating,
          google_reviews: row.google_reviews,
          telefone_1: (detail as any).telefone_1 ?? row.telefone_1,
        };
      } catch {
        return row;
      }
    });

    let created = 0;
    if (enrichedRows.length) {
      const { data: inserted, error: iErr } = await supabase
        .from("leads").insert(enrichedRows).select("id");
      if (iErr && !String(iErr.message).includes("duplicate")) throw iErr;
      created = inserted?.length ?? enrichedRows.length;
    }

    await supabase.from("enrichment_jobs")
      .update({ status: "done", progress: 100, leads_created: created }).eq("id", job.id);

    return { ...job, status: "done", leads_created: created };
  });

// Enriquecer em lote leads com CNPJ e sem QSA salvo
export const enrichMissingSocios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: leads } = await supabase
      .from("leads").select("id, cnpj").eq("user_id", userId)
      .not("cnpj", "is", null).is("socios", null).limit(30);
    let ok = 0;
    for (const l of leads ?? []) {
      const mapped = await enrichByCnpj(l.cnpj as string);
      if (!mapped) continue;
      const { cnpj: _c, ...updates } = mapped as any;
      await supabase.from("leads").update(updates).eq("id", l.id);
      ok++;
    }
    return { processed: leads?.length ?? 0, ok };
  });