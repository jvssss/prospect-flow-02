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

/** Normalização compartilhada para comparar cidades. */
function normCity(s?: string | null): string {
  return (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
/** True quando duas cidades são "a mesma" (tolerante a acento/caixa/sufixos). */
function sameCity(a?: string | null, b?: string | null): boolean {
  const na = normCity(a); const nb = normCity(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Extrai CEP (8 dígitos) de qualquer string. */
function extractCep(s?: string | null): string | null {
  if (!s) return null;
  const m = String(s).match(/\b\d{5}-?\d{3}\b/);
  if (!m) return null;
  const d = m[0].replace(/\D/g, "");
  return d.length === 8 ? d : null;
}
/** Normaliza telefone BR: remove +/0/55 do começo. Devolve DDD+número (10-11 dígitos) ou null. */
function normalizeBrPhone(s?: string | null): string | null {
  if (!s) return null;
  let d = String(s).replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0") && d.length >= 11) d = d.slice(1);
  if (d.length < 10 || d.length > 11) return null;
  return d;
}
/** True se o payload da CNPJá indicar CNPJ inativo (Baixada/Inapta/Suspensa/Nula). */
function isInactivePayload(p: any): boolean {
  const txt = (p?.status?.text ?? p?.company?.status?.text ?? "").toString().toLowerCase();
  if (!txt) return false;
  return /baixad|inapt|suspens|nula/.test(txt);
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
    // Estrito: se nada bate na cidade alvo, descarta (evita casar homônimo em outra cidade).
    return records.filter((r) => sameCity(r?.address?.city, cidade));
  } catch {
    return [];
  }
}

// -------- Normalização + variantes de nome para busca CNPJá --------
function stripDiacritics(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function cleanName(s: string) {
  return stripDiacritics(s)
    // remove emojis / símbolos
    .replace(/[\p{Extended_Pictographic}\u2600-\u27BF]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
/** Gera variantes de nome, do mais específico ao mais genérico. */
function nameCandidates(raw: string, cidade?: string | null): string[] {
  const seen = new Set<string>();
  const push = (v: string) => {
    const cleaned = cleanName(v);
    if (cleaned && cleaned.length >= 4 && !seen.has(cleaned.toLowerCase())) {
      seen.add(cleaned.toLowerCase());
    }
  };
  const base = cleanName(raw);
  push(base);
  // corta em separadores
  const cuts = base.split(/[|\-–—•/,()]/).map((s) => s.trim()).filter(Boolean);
  for (const c of cuts) push(c);
  // remove cidade no final
  if (cidade) {
    const city = cleanName(cidade);
    const re = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "gi");
    push(base.replace(re, ""));
    for (const c of cuts) push(c.replace(re, ""));
  }
  // sinônimos comuns do nicho
  const swaps: [RegExp, string][] = [
    [/\bcfc\b/gi, "Centro de Formação de Condutores"],
    [/\bcentro de formacao de condutores\b/gi, "CFC"],
    [/\bauto\s+escola\b/gi, "Autoescola"],
    [/\bautoescola\b/gi, "Auto Escola"],
  ];
  const swapped = new Set<string>(Array.from(seen));
  for (const s of Array.from(swapped)) {
    for (const [re, out] of swaps) {
      if (re.test(s)) push(s.replace(re, out));
    }
  }
  // ordena: mais longas primeiro (mais específicas)
  return Array.from(seen).sort((a, b) => b.length - a.length);
}

/** Busca por telefone (DDD+numero). Aceita se retornar poucos registros na mesma UF. */
async function cnpjaSearchByPhone(
  phone: string,
  uf?: string | null,
  cidade?: string | null,
): Promise<any[]> {
  if (!process.env.CNPJA_API_KEY || !phone) return [];
  const digits = normalizeBrPhone(phone);
  if (!digits) return [];
  const params = new URLSearchParams();
  params.set("phones.in", digits);
  const nUf = normalizeUf(uf ?? null);
  if (nUf) params.set("address.state.in", nUf);
  params.set("limit", "5");
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
    // Telefone é uma chave forte: se retorna 1 único registro, aceita mesmo fora da cidade
    // (DDD compartilhado às vezes mostra cidade vizinha). Se retornar 2+, filtra por cidade.
    if (!cidade || records.length <= 1) return records;
    const filtered = records.filter((r) => sameCity(r?.address?.city, cidade));
    return filtered.length > 0 ? filtered : [];
  } catch {
    return [];
  }
}

/** Busca por CEP — chave altamente específica quando o nome é ruidoso. */
async function cnpjaSearchByPostal(
  cep: string,
  cidade?: string | null,
): Promise<any[]> {
  if (!process.env.CNPJA_API_KEY || !cep) return [];
  const d = cep.replace(/\D/g, "");
  if (d.length !== 8) return [];
  const params = new URLSearchParams();
  params.set("address.postal.in", d);
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
    return records.filter((r) => sameCity(r?.address?.city, cidade));
  } catch {
    return [];
  }
}

/** Busca por bairro + primeira palavra significativa do nome. */
async function cnpjaSearchByDistrict(
  nomeFragmento: string,
  bairro: string,
  cidade?: string | null,
  uf?: string | null,
): Promise<any[]> {
  if (!process.env.CNPJA_API_KEY || !nomeFragmento || !bairro) return [];
  const params = new URLSearchParams();
  params.set("names.in", cleanName(nomeFragmento));
  params.set("address.district.in", cleanName(bairro));
  const nUf = normalizeUf(uf ?? null);
  if (nUf) params.set("address.state.in", nUf);
  params.set("limit", "10");
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
    return records.filter((r) => sameCity(r?.address?.city, cidade));
  } catch {
    return [];
  }
}

/**
 * Cascata completa: name → phone → CEP → district → SERP.
 * Retorna { detail, cnpj, strategy } ou null. Compartilhada por ingest e JIT.
 */
async function cascadeFindCompany(row: {
  nome_fantasia?: string | null;
  cidade?: string | null;
  uf?: string | null;
  bairro?: string | null;
  endereco?: string | null;
  telefone_1?: string | null;
  telefone_2?: string | null;
}): Promise<{ detail: any; cnpj: string | null; strategy: "name" | "phone" | "cep" | "district" | "serp" } | null> {
  const hasPaid = !!process.env.CNPJA_API_KEY;
  const nome = row.nome_fantasia ?? "";
  const cidade = row.cidade ?? null;
  const uf = row.uf ?? null;

  // 1) Nome + variantes
  if (hasPaid && nome) {
    const d = await cnpjaFindByNameVariants(nome, cidade, uf);
    if (d) return { detail: d, cnpj: (d?.taxId ?? "").toString().replace(/\D/g, "") || null, strategy: "name" };
  }
  // 2) Telefones
  if (hasPaid) {
    for (const t of [row.telefone_1, row.telefone_2]) {
      if (!t) continue;
      const results = await cnpjaSearchByPhone(t as string, uf, cidade);
      if (results.length >= 1 && results.length <= 3) {
        const d = results[0];
        return { detail: d, cnpj: (d?.taxId ?? "").toString().replace(/\D/g, "") || null, strategy: "phone" };
      }
    }
  }
  // 3) CEP
  if (hasPaid) {
    const cep = extractCep(row.endereco) ?? extractCep(row.bairro);
    if (cep) {
      const results = await cnpjaSearchByPostal(cep, cidade);
      // se poucos resultados, tenta casar por primeira palavra do nome; senão pega o único
      if (results.length === 1) {
        const d = results[0];
        return { detail: d, cnpj: (d?.taxId ?? "").toString().replace(/\D/g, "") || null, strategy: "cep" };
      }
      if (results.length > 1 && nome) {
        const first = cleanName(nome).split(/\s+/)[0]?.toLowerCase();
        const hit = results.find((r: any) => {
          const rn = ((r?.company?.name ?? r?.alias ?? "") + "").toLowerCase();
          return first && rn.includes(first);
        });
        if (hit) return { detail: hit, cnpj: (hit?.taxId ?? "").toString().replace(/\D/g, "") || null, strategy: "cep" };
      }
    }
  }
  // 4) Bairro + fragmento de nome
  if (hasPaid && row.bairro && nome) {
    const first = cleanName(nome).split(/\s+/).find((w) => w.length >= 4);
    if (first) {
      const results = await cnpjaSearchByDistrict(first, row.bairro, cidade, uf);
      if (results.length >= 1 && results.length <= 3) {
        const d = results[0];
        return { detail: d, cnpj: (d?.taxId ?? "").toString().replace(/\D/g, "") || null, strategy: "district" };
      }
    }
  }
  // 5) SERP fallback
  if (nome) {
    const cnpj = await findCnpjByText(nome, cidade);
    if (cnpj) {
      try {
        const d = await fetchCnpjaOffice(cnpj);
        if (d) return { detail: d, cnpj, strategy: "serp" };
      } catch { /* ignore */ }
    }
  }
  return null;
}

/** Tenta várias variantes de nome no CNPJá até casar dentro da cidade. */
async function cnpjaFindByNameVariants(
  nome: string,
  cidade?: string | null,
  uf?: string | null,
): Promise<any | null> {
  const cands = nameCandidates(nome, cidade);
  for (const cand of cands) {
    const results = await cnpjaSearchByName(cand, cidade, uf);
    if (results.length > 0) return results[0];
  }
  return null;
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

/**
 * Mescla updates do CNPJ Já em uma linha base, preservando valores existentes se o novo vier vazio.
 * Nunca sobrescreve cidade/uf/bairro/endereco — a geografia vem do Google Maps e é a fonte confiável.
 * Se `mapped.cidade` existir e não casar com `row.cidade`, retorna a linha original sem mudanças.
 */
function mergeCnpjaOntoRow<T extends Record<string, any>>(row: T, detail: any): T {
  const mapped = mapCnpja(detail);
  if (!mapped) return row;
  if (mapped.cidade && (row as any).cidade && !sameCity(mapped.cidade, (row as any).cidade)) {
    return row;
  }
  // Remove campos geográficos + vazios do payload para não sobrescrever o Maps.
  const GEO_FIELDS = new Set(["cidade", "uf", "bairro", "endereco"]);
  const clean = Object.fromEntries(
    Object.entries(mapped).filter(
      ([k, v]) => v != null && v !== "" && !GEO_FIELDS.has(k),
    ),
  );
  const inactive = isInactivePayload(detail);
  return {
    ...row,
    ...clean,
    enrichment_status: inactive ? "inactive" : "enriched",
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

    // Ingest rápido: insere apenas os dados do Google Maps. O enriquecimento
    // (CNPJá + QSA) roda depois em `enrichMissingSocios`, com concorrência,
    // para não estourar o orçamento do Worker (~90s) durante o ingest.
    await supabase.from("enrichment_jobs").update({ progress: 90 }).eq("id", job.id);

    let created = 0;
    if (baseRows.length) {
      const { data: inserted, error: iErr } = await supabase
        .from("leads").insert(baseRows).select("id");
      if (iErr && !String(iErr.message).includes("duplicate")) throw iErr;
      created = inserted?.length ?? baseRows.length;
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
    const hasPaid = !!process.env.CNPJA_API_KEY;
    let apiCalls = 0;
    const callCnpja = async (cnpj: string) => {
      // Paga = sem throttle agressivo; open (grátis) = 5 req/min
      if (apiCalls > 0 && !hasPaid) await sleep(12500);
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

    // Orçamento de tempo (Worker ~90s). Sai limpo antes de estourar.
    const t0 = Date.now();
    const TIME_BUDGET_MS = 85_000;
    const MAX_LEADS = 300;
    const timeUp = () => Date.now() - t0 > TIME_BUDGET_MS;

    // Nunca sobrescreve cidade/uf/bairro/endereco. Se o mapped indicar cidade diferente
    // da cidade atual do lead, o match é rejeitado.
    const GEO_FIELDS = new Set(["cidade", "uf", "bairro", "endereco"]);
    const applyUpdates = async (
      leadId: string,
      leadCidade: string | null,
      cnpj: string | null,
      detail: any | null,
    ): Promise<"applied" | "rejected" | "noop"> => {
      const mapped = detail ? mapCnpja(detail) : null;
      if (mapped && mapped.cidade && leadCidade && !sameCity(mapped.cidade, leadCidade)) {
        return "rejected";
      }
      const updates: Record<string, any> = {};
      if (cnpj) updates.cnpj = cnpj;
      if (mapped) {
        for (const [k, v] of Object.entries(mapped as any)) {
          if (k === "cnpj" || GEO_FIELDS.has(k)) continue;
          if (v != null && v !== "") updates[k] = v;
        }
        updates.enrichment_status = "enriched";
      }
      if (Object.keys(updates).length === 0) return "noop";
      await supabase.from("leads").update(updates as any).eq("id", leadId);
      return "applied";
    };

    // -------- 1) Leads que já têm CNPJ mas sem sócios (lookup direto) --------
    const { data: withCnpj } = await supabase
      .from("leads").select("id, cnpj, cidade")
      .not("cnpj", "is", null).is("socios", null).limit(MAX_LEADS);
    let matched_by_cnpj = 0;
    for (const l of withCnpj ?? []) {
      if (timeUp()) break;
      const payload = await callCnpja(l.cnpj as string);
      if (!payload) continue;
      const res = await applyUpdates(l.id, (l as any).cidade ?? null, null, payload);
      if (res === "applied") matched_by_cnpj++;
    }

    // -------- 2) Leads sem CNPJ: variantes de nome → telefone → SERP --------
    // Ignora leads já marcados como not_found para não gastar API repetidamente.
    const { data: noCnpj } = await supabase
      .from("leads")
      .select("id, nome_fantasia, cidade, uf, telefone_1, telefone_2, bairro, endereco")
      .is("cnpj", null).is("socios", null)
      .or("enrichment_status.is.null,enrichment_status.eq.retry")
      .limit(MAX_LEADS);

    let scanned = 0;
    let matched_by_name = 0;
    let matched_by_phone = 0;
    let matched_by_cep = 0;
    let matched_by_district = 0;
    let matched_by_serp = 0;
    let not_found = 0;

    for (const l of noCnpj ?? []) {
      if (timeUp()) break;
      if (!l.nome_fantasia) continue;
      scanned++;
      const found = await cascadeFindCompany(l as any);
      const detail = found?.detail ?? null;
      const cnpj = found?.cnpj ?? null;
      const strategy = found?.strategy ?? null;

      if (detail) {
        const res = await applyUpdates(l.id, l.cidade as any, cnpj, detail);
        if (res === "applied") {
          if (strategy === "name") matched_by_name++;
          else if (strategy === "phone") matched_by_phone++;
          else if (strategy === "cep") matched_by_cep++;
          else if (strategy === "district") matched_by_district++;
          else if (strategy === "serp") matched_by_serp++;
        } else if (res === "rejected") {
          await supabase.from("leads")
            .update({ enrichment_status: "not_found" })
            .eq("id", l.id);
          not_found++;
        }
      } else if (cnpj) {
        // achou CNPJ mas não conseguiu detalhe — persiste ao menos o CNPJ
        await supabase.from("leads").update({ cnpj }).eq("id", l.id);
      } else {
        await supabase.from("leads")
          .update({ enrichment_status: "not_found" })
          .eq("id", l.id);
        not_found++;
      }
    }

    return {
      withCnpj: withCnpj?.length ?? 0,
      ok: matched_by_cnpj,
      searched: scanned,
      matched: matched_by_name + matched_by_phone + matched_by_cep + matched_by_district + matched_by_serp,
      matched_by_name,
      matched_by_phone,
      matched_by_cep,
      matched_by_district,
      matched_by_serp,
      not_found,
      elapsed_ms: Date.now() - t0,
      exhausted: timeUp(),
    };
  });

// ---------- Enriquecimento JIT (Modo Foco) ----------
// Busca proprietário/QSA para 1 lead específico sob demanda. Retorna { ok, strategy? }.
export const enrichLeadOnDemand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id, cnpj, nome_fantasia, cidade, uf, telefone_1, telefone_2, bairro, endereco, socios, proprietario, enrichment_status")
      .eq("id", data.leadId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!lead) throw new Error("Lead não encontrado");

    // 1) Se já tem CNPJ, só falta QSA → lookup direto
    if (lead.cnpj) {
      try {
        const payload = await fetchCnpjaOffice(lead.cnpj as string);
        const mapped = mapCnpja(payload);
        if (mapped) {
          const updates: Record<string, any> = { enrichment_status: isInactivePayload(payload) ? "inactive" : "enriched" };
          for (const [k, v] of Object.entries(mapped)) {
            if (k === "cnpj" || k === "cidade" || k === "uf" || k === "bairro" || k === "endereco") continue;
            if (v != null && v !== "") updates[k] = v;
          }
          await supabase.from("leads").update(updates as any).eq("id", lead.id);
          return { ok: true, strategy: "cnpj" };
        }
      } catch { /* cai pra cascata */ }
    }

    // 2) Cascata name → phone → CEP → district → SERP
    const found = await cascadeFindCompany(lead as any);
    if (!found?.detail) {
      await supabase.from("leads")
        .update({ enrichment_status: "not_found" })
        .eq("id", lead.id);
      return { ok: false };
    }
    const mapped = mapCnpja(found.detail);
    if (!mapped) return { ok: false };
    // Rejeita match de outra cidade (exceto quando bateu por telefone, chave forte)
    if (found.strategy !== "phone" && mapped.cidade && (lead as any).cidade && !sameCity(mapped.cidade, (lead as any).cidade)) {
      await supabase.from("leads").update({ enrichment_status: "not_found" }).eq("id", lead.id);
      return { ok: false };
    }
    const updates: Record<string, any> = {
      enrichment_status: isInactivePayload(found.detail) ? "inactive" : "enriched",
    };
    if (found.cnpj) updates.cnpj = found.cnpj;
    for (const [k, v] of Object.entries(mapped)) {
      if (k === "cnpj" || k === "cidade" || k === "uf" || k === "bairro" || k === "endereco") continue;
      if (v != null && v !== "") updates[k] = v;
    }
    await supabase.from("leads").update(updates as any).eq("id", lead.id);
    return { ok: true, strategy: found.strategy };
  });