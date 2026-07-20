import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- CNPJ enrichment (via publica.cnpj.ws — grátis, retorna QSA) ----------

async function fetchCnpjData(cnpj: string) {
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) throw new Error("CNPJ inválido");
  const res = await fetch(`https://publica.cnpj.ws/cnpj/${clean}`, {
    headers: { accept: "application/json" },
  });
  if (res.status === 429) throw new Error("Limite de consultas atingido, tente em instantes");
  if (!res.ok) throw new Error(`CNPJ API ${res.status}`);
  return res.json() as Promise<any>;
}

function mapCnpjPayload(payload: any) {
  const est = payload?.estabelecimento ?? {};
  const tel1 = est?.ddd1 && est?.telefone1 ? `${est.ddd1}${est.telefone1}` : null;
  const tel2 = est?.ddd2 && est?.telefone2 ? `${est.ddd2}${est.telefone2}` : null;
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
    qsa: Array.isArray(payload?.socios) ? payload.socios : null,
  };
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

    const payload = await fetchCnpjData(lead.cnpj);
    const mapped = mapCnpjPayload(payload);

    const { error: upErr } = await supabase.from("leads").update(mapped).eq("id", lead.id);
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
    const rows = items.map((p: any) => ({
      user_id: userId,
      source: "apify_gmaps",
      enrichment_job_id: job.id,
      status: "new",
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
      cnpj: null,
    })).filter((r) => r.nome_fantasia);

    let created = 0;
    if (rows.length) {
      const { data: inserted, error: iErr } = await supabase
        .from("leads").insert(rows).select("id, cnpj");
      if (iErr && !String(iErr.message).includes("duplicate")) throw iErr;
      created = inserted?.length ?? rows.length;

      // Auto-enrich CNPJ (QSA / capital social) via publica.cnpj.ws
      const withCnpj = (inserted ?? []).filter((r: any) => r.cnpj);
      for (const r of withCnpj) {
        try {
          const payload = await fetchCnpjData(r.cnpj as string);
          const mapped = mapCnpjPayload(payload);
          const socios = Array.isArray(mapped.qsa) ? mapped.qsa : null;
          const proprietario = socios?.[0]?.nome ?? socios?.[0]?.nome_socio ?? null;
          await supabase.from("leads").update({ ...mapped, socios, proprietario }).eq("id", r.id);
        } catch { /* rate-limit tolerant */ }
      }
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
      try {
        const payload = await fetchCnpjData(l.cnpj as string);
        const mapped = mapCnpjPayload(payload);
        const socios = Array.isArray(mapped.qsa) ? mapped.qsa : null;
        const proprietario = socios?.[0]?.nome ?? null;
        await supabase.from("leads").update({ ...mapped, socios, proprietario }).eq("id", l.id);
        ok++;
      } catch { /* continue */ }
    }
    return { processed: leads?.length ?? 0, ok };
  });