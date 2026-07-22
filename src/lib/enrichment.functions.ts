import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// =====================================================================
// CNPJ enrichment
//   - Etapa B: Busca por nome+UF via api.cnpja.com/office (já retorna QSA)
//   - Etapa C: api.cnpja.com/office/{cnpj} para lookup direto por CNPJ
//   - Fallback: DuckDuckGo HTML + open.cnpja.com se a paga falhar
// =====================================================================

const UF_MAP: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", "amapá": "AP", amazonas: "AM",
  bahia: "BA", ceara: "CE", "ceará": "CE", "distrito federal": "DF",
  "espirito santo": "ES", "espírito santo": "ES", goias: "GO", "goiás": "GO",
  maranhao: "MA", "maranhão": "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  "minas gerais": "MG", para: "PA", "pará": "PA", paraiba: "PB", "paraíba": "PB",
  parana: "PR", "paraná": "PR", pernambuco: "PE", piaui: "PI", "piauí": "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
  rondonia: "RO", "rondônia": "RO", roraima: "RR", "santa catarina": "SC",
  "sao paulo": "SP", "são paulo": "SP", sergipe: "SE", tocantins: "TO",
};
function normalizeUf(v?: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (s.length === 2) return s.toUpperCase();
  return UF_MAP[s.toLowerCase()] ?? null;
}

// ---------- helpers ----------
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Valida dígitos verificadores do CNPJ. */
function isValidCnpj(raw: string): boolean {
  const c = raw.replace(/\D/g, "");
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string) => {
    const w = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += parseInt(base[i], 10) * w[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12));
  const d2 = calc(c.slice(0, 12) + d1);
  return d1 === parseInt(c[12], 10) && d2 === parseInt(c[13], 10);
}

const CNPJ_REGEX = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

/** Descobridor de CNPJ: busca "{nome} {cidade} CNPJ" no DuckDuckGo HTML e aplica regex. */
async function findCnpjByText(nome: string, cidade?: string | null): Promise<string | null> {
  if (!nome) return null;
  const q = `${nome} ${cidade ?? ""} CNPJ`.trim();
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { "user-agent": BROWSER_UA, accept: "text/html" } },
      8000,
    );
    if (!res.ok) return null;
    const html = await res.text();
    const matches = html.match(CNPJ_REGEX) ?? [];
    for (const m of matches) {
      const digits = m.replace(/\D/g, "");
      if (isValidCnpj(digits)) return digits;
    }
    return null;
  } catch {
    return null;
  }
}

const CNPJA_BASE = "https://api.cnpja.com";
const CNPJA_OPEN_BASE = "https://open.cnpja.com";

function cnpjaHeaders(): Record<string, string> {
  const key = process.env.CNPJA_API_KEY;
  const h: Record<string, string> = { accept: "application/json", "user-agent": BROWSER_UA };
  if (key) h["Authorization"] = key;
  return h;
}

/** Sinal ao orquestrador de que precisamos aguardar (429). */
class RateLimitError extends Error {
  constructor() { super("open.cnpja rate limited"); }
}

/** GET /office/{cnpj} — usa api.cnpja.com se CNPJA_API_KEY setada, senão open.cnpja. */
async function fetchCnpjaOffice(cnpj: string): Promise<any> {
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) throw new Error("CNPJ inválido");
  const base = process.env.CNPJA_API_KEY ? CNPJA_BASE : CNPJA_OPEN_BASE;
  const res = await fetchWithTimeout(
    `${base}/office/${clean}`,
    { headers: cnpjaHeaders() },
    12000,
  );
  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) throw new Error(`cnpja ${res.status}`);
  return res.json();
}

/**
 * Busca estabelecimentos por nome+UF na CNPJá paga.
 * Cada item já vem com address/company/members (QSA) — 1 chamada = busca + enriquecimento.
 */
async function cnpjaSearchByName(
  nome: string,
  cidade?: string | null,
  uf?: string | null,
): Promise<any[]> {
  if (!process.env.CNPJA_API_KEY || !nome) return [];
  const params = new URLSearchParams();
  params.set("names.in", nome);
  const nUf = normalizeUf(uf ?? null);
  if (nUf) params.set("address.state.in", nUf);
  params.set("limit", "20");
  try {
    const res = await fetchWithTimeout(
      `${CNPJA_BASE}/office?${params.toString()}`,
      { headers: cnpjaHeaders() },
      12000,
    );
    if (!res.ok) return [];
    const json: any = await res.json();
    const records: any[] = Array.isArray(json?.records) ? json.records
      : Array.isArray(json?.data) ? json.data
      : Array.isArray(json) ? json : [];
    if (!cidade) return records;
    const norm = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const target = norm(cidade);
    const matches = records.filter((r) => {
      const c = norm((r?.address?.city ?? "").toString());
      return c && (c === target || c.includes(target) || target.includes(c));
    });
    return matches.length ? matches : records;
  } catch {
    return [];
  }
}

/** Payload open.cnpja → row parcial de lead. */
function mapCnpja(p: any) {
  if (!p) return null;
  const company = p.company ?? {};
  const members: any[] = Array.isArray(company.members) ? company.members : [];
  const socios = members
    .map((m) => ({
      nome: m?.person?.name ?? null,
      qualificacao: m?.role?.text ?? null,
    }))
    .filter((s) => s.nome);
  const emails: any[] = Array.isArray(p.emails) ? p.emails : [];
  const phones: any[] = Array.isArray(p.phones) ? p.phones : [];
  const address = p.address ?? {};
  const tel = (t: any) =>
    t && t.area && t.number ? `${t.area}${t.number}` : t?.number ?? null;
  const cnpj = (p.taxId ?? "").toString().replace(/\D/g, "") || null;
  return {
    cnpj,
    razao_social: company.name ?? null,
    nome_fantasia: p.alias ?? null,
    capital_social: company.equity != null ? Number(company.equity) : null,
    data_abertura: p.founded ?? null,
    bairro: address.district ?? null,
    cidade: address.city ?? null,
    uf: normalizeUf(address.state) ?? address.state ?? null,
    endereco:
      [address.street, address.number].filter(Boolean).join(" ") || null,
    telefone_1: tel(phones[0]),
    telefone_2: tel(phones[1]),
    email: emails[0]?.address ?? null,
    socios: socios.length ? socios : null,
    proprietario: socios[0]?.nome ?? null,
  };
}

/** Mescla updates do CNPJ Já em uma linha base, preservando valores existentes se o novo vier vazio. */
function mergeCnpjaOntoRow<T extends Record<string, any>>(row: T, detail: any): T {
  const mapped = mapCnpja(detail);
  if (!mapped) return row;
  const clean = Object.fromEntries(
    Object.entries(mapped).filter(([, v]) => v != null && v !== ""),
  );
  return {
    ...row,
    ...clean,
    // preserva sinais únicos do Maps
    website: (row as any).website ?? null,
    google_rating: (row as any).google_rating,
    google_reviews: (row as any).google_reviews,
    telefone_1: (clean as any).telefone_1 ?? (row as any).telefone_1,
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
    let payload: any;
    try {
      payload = await fetchCnpjaOffice(lead.cnpj);
    } catch (e) {
      throw new Error(
        e instanceof RateLimitError
          ? "Limite temporário do CNPJ Já atingido — tente em ~1 min"
          : "Não foi possível enriquecer este CNPJ",
      );
    }
    const mapped = mapCnpja(payload);
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
        searchStringsArray: [data.niche],
        locationQuery: `${data.city}, Brasil`,
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
    // Normalização para comparar cidades ("São Paulo" == "sao paulo")
    const norm = (s?: string | null) =>
      (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const targetCity = norm(job.city);
    // Filtro geográfico: só aceitar locais cuja cidade bata com a buscada.
    // Isso evita retornar autoescolas cujo NOME contém "Santa Marina" mas ficam em outra cidade.
    const filteredItems = items.filter((p: any) => {
      const c = norm(p.city ?? p.address ?? "");
      return targetCity && (c === targetCity || c.includes(targetCity));
    });
    const baseRows = filteredItems.map((p: any) => ({
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
      uf: normalizeUf(p.state) ?? p.state ?? null,
      website: p.website ?? null,
      google_rating: p.totalScore ?? null,
      google_reviews: p.reviewsCount ?? null,
      cnpj: null as string | null,
    })).filter((r) => r.nome_fantasia);

    // Passo 2/3: pipeline serial — descobrir CNPJ (SERP + regex) e enriquecer em open.cnpja
    // respeitando 5 req/min (12,5s entre chamadas). Falha silenciosa por lead.
    const enrichedRows: typeof baseRows = [];
    const total = baseRows.length;
    const hasPaid = !!process.env.CNPJA_API_KEY;
    for (let i = 0; i < total; i++) {
      const row = baseRows[i];
      try {
        let detail: any = null;
        let cnpj: string | null = null;
        // 1) Preferido: CNPJá paga (busca + QSA em 1 chamada)
        if (hasPaid) {
          const results = await cnpjaSearchByName(row.nome_fantasia!, row.cidade, row.uf);
          if (results.length > 0) {
            detail = results[0];
            cnpj = (detail?.taxId ?? "").toString().replace(/\D/g, "") || null;
          }
        }
        // 2) Fallback: DuckDuckGo + lookup direto
        if (!detail) {
          cnpj = await findCnpjByText(row.nome_fantasia!, row.cidade);
          if (cnpj) {
            try {
              detail = await fetchCnpjaOffice(cnpj);
            } catch (e) {
              if (e instanceof RateLimitError) await sleep(12500);
            }
          }
        }
        if (detail) {
          enrichedRows.push(mergeCnpjaOntoRow({ ...row, cnpj: cnpj ?? row.cnpj }, detail));
        } else if (cnpj) {
          enrichedRows.push({ ...row, cnpj });
        } else {
          enrichedRows.push(row);
        }
      } catch {
        enrichedRows.push(row);
      }
      // progresso incremental 30 → 95
      const progress = 30 + Math.floor(((i + 1) / total) * 65);
      await supabase.from("enrichment_jobs").update({ progress }).eq("id", job.id);
    }

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
    const { supabase } = context;
    let apiCalls = 0;
    const callCnpja = async (cnpj: string) => {
      if (apiCalls > 0) await sleep(12500);
      try {
        const p = await fetchCnpjaOffice(cnpj);
        apiCalls++;
        return p;
      } catch (e) {
        if (e instanceof RateLimitError) {
          await sleep(12500);
          try {
            const p = await fetchCnpjaOffice(cnpj);
            apiCalls++;
            return p;
          } catch { return null; }
        }
        return null;
      }
    };

    // 1) Leads que já têm CNPJ mas sem sócios → busca detalhe direto (serial)
    const { data: withCnpj } = await supabase
      .from("leads").select("id, cnpj")
      .not("cnpj", "is", null).is("socios", null).limit(50);
    let ok = 0;
    for (const l of withCnpj ?? []) {
      const payload = await callCnpja(l.cnpj as string);
      const mapped = mapCnpja(payload);
      if (!mapped) continue;
      const { cnpj: _c, ...updates } = mapped as any;
      await supabase.from("leads").update(updates).eq("id", l.id);
      ok++;
    }
    // 2) Leads sem CNPJ (Apify puro) → SERP + regex, depois enriquece (serial)
    const { data: noCnpj } = await supabase
      .from("leads").select("id, nome_fantasia, cidade, uf")
      .is("cnpj", null).is("socios", null).limit(50);
    let matched = 0;
    for (const l of noCnpj ?? []) {
      if (!l.nome_fantasia) continue;
      const cnpj = await findCnpjByText(l.nome_fantasia, l.cidade as any);
      if (!cnpj) continue;
      const payload = await callCnpja(cnpj);
      const mapped = mapCnpja(payload);
      if (!mapped) {
        await supabase.from("leads").update({ cnpj }).eq("id", l.id);
        continue;
      }
      const updates: Record<string, any> = { cnpj };
      for (const [k, v] of Object.entries(mapped as any)) {
        if (v != null && v !== "") updates[k] = v;
      }
      await supabase.from("leads").update(updates as any).eq("id", l.id);
      matched++;
    }
    return { withCnpj: withCnpj?.length ?? 0, ok, searched: noCnpj?.length ?? 0, matched };
  });