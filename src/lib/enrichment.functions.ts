import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchAutoescola, normCidade, toCnpjaShape, type RfbEstab, type RfbSocio } from "@/lib/rfb-match";
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

/**
 * Conurbações conhecidas — aceitar match quando lead e CNPJ estão na mesma
 * região metropolitana. Editável: adicionar novas listas conforme necessário.
 * A geografia final NUNCA é sobrescrita — isso só relaxa o aceite do match.
 */
const CONURBATIONS: string[][] = [
  // Vale do Aço (MG)
  ["ipatinga", "coronel fabriciano", "timoteo", "santana do paraiso"],
  // Grande BH
  ["belo horizonte", "contagem", "betim", "nova lima", "santa luzia", "ribeirao das neves", "sabara", "vespasiano", "ibirite"],
  // Grande Vitória
  ["vitoria", "vila velha", "serra", "cariacica", "viana", "guarapari"],
  // Grande SP + ABC
  ["sao paulo", "guarulhos", "osasco", "santo andre", "sao bernardo do campo", "sao caetano do sul", "diadema", "maua", "ribeirao pires", "taboao da serra", "barueri", "cotia", "carapicuiba", "embu das artes", "itapecerica da serra", "suzano", "mogi das cruzes", "itaquaquecetuba"],
  // Baixada Santista
  ["santos", "sao vicente", "guaruja", "praia grande", "cubatao", "bertioga"],
  // Grande Rio
  ["rio de janeiro", "niteroi", "sao goncalo", "duque de caxias", "nova iguacu", "belford roxo", "sao joao de meriti", "nilopolis", "queimados", "mesquita", "magé", "itaguai"],
  // RIDE-DF
  ["brasilia", "aguas claras", "taguatinga", "ceilandia", "gama", "sobradinho", "planaltina", "samambaia", "recanto das emas", "santa maria", "riacho fundo"],
  // Grande Curitiba
  ["curitiba", "sao jose dos pinhais", "colombo", "pinhais", "araucaria", "fazenda rio grande"],
  // Grande Porto Alegre
  ["porto alegre", "canoas", "novo hamburgo", "sao leopoldo", "gravatai", "viamao", "cachoeirinha", "alvorada", "esteio", "sapucaia do sul"],
  // Cachoeiro
  ["cachoeiro de itapemirim", "itapemirim"],
];
function inSameConurbation(a: string, b: string): boolean {
  for (const group of CONURBATIONS) {
    if (group.includes(a) && group.includes(b)) return true;
  }
  return false;
}
/**
 * Distância de Levenshtein normalizada (0..1). Usada como salvaguarda extra
 * quando cidades diferem por sufixo curto (ex.: "Timóteo" vs "Timoteo Bairro").
 */
function levNorm(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return 1;
  const m = a.length, n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n] / Math.max(m, n);
}
/**
 * Aceita match quando as cidades são "a mesma" (sameCity) OU estão na mesma
 * conurbação OU são muito parecidas (Levenshtein ≤ 0.35). Usada nos filtros
 * de busca CNPJá. Nunca substitui a proteção do merge geográfico.
 */
function acceptCityMatch(leadCity?: string | null, cnpjCity?: string | null): boolean {
  if (sameCity(leadCity, cnpjCity)) return true;
  const a = normCity(leadCity); const b = normCity(cnpjCity);
  if (!a || !b) return false;
  if (inSameConurbation(a, b)) return true;
  if (levNorm(a, b) <= 0.35) return true;
  return false;
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

/**
 * Diagnóstico da CNPJá.
 *
 * As buscas abaixo fazem `catch { return [] }`, o que apaga 401 (chave errada),
 * 402 (sem crédito), 400 (parâmetro inválido) e 403 (plano sem busca) sem deixar
 * rastro. O enriquecimento roda há um mês em ~20% e ninguém sabe por quê.
 * Aqui as falhas são acumuladas e gravadas em `public.diagnosticos` ao fim do
 * lote, para o motivo real aparecer em vez de virar mais um `not_found`.
 */
const falhasCnpja: string[] = [];
function registrarFalhaCnpja(onde: string, detalhe: string) {
  if (falhasCnpja.length >= 8) return;
  const msg = `${onde}: ${detalhe}`;
  if (!falhasCnpja.includes(msg)) falhasCnpja.push(msg);
}

/** Grava o que a CNPJá respondeu e limpa o acumulador. */
async function gravarDiagnostico(contexto: string) {
  if (!falhasCnpja.length) return;
  const mensagem = falhasCnpja.join(" | ");
  falhasCnpja.length = 0;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as unknown as SupabaseClient)
      .from("diagnosticos")
      .insert({ contexto, mensagem });
  } catch {
    /* diagnóstico nunca pode derrubar o enriquecimento */
  }
}

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
  if (!process.env.CNPJA_API_KEY) {
    registrarFalhaCnpja("buscaPorNome", "CNPJA_API_KEY ausente no runtime");
    return [];
  }
  if (!nome) return [];
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
    if (!res.ok) {
      // O corpo é onde a CNPJá explica o motivo: chave inválida, sem crédito,
      // parâmetro desconhecido ou plano que não inclui busca. Os params no
      // registro dizem qual das quatro buscas falhou.
      const corpo = await res.text().catch(() => "");
      registrarFalhaCnpja("busca", `HTTP ${res.status} · ${params.toString()} · ${corpo.slice(0, 250)}`);
      return [];
    }
    const json: any = await res.json();
    const records: any[] = Array.isArray(json?.records) ? json.records
      : Array.isArray(json?.data) ? json.data
      : Array.isArray(json) ? json : [];
    if (!cidade) return records;
    // Estrito: se nada bate na cidade alvo, descarta (evita casar homônimo em outra cidade).
    return records.filter((r) => acceptCityMatch(cidade, r?.address?.city));
  } catch (e) {
    registrarFalhaCnpja("busca", `exceção: ${String(e).slice(0, 200)}`);
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
  // Remove "(Cidade-UF)" ou "(Cidade)" no final
  const baseNoParens = base.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  push(baseNoParens);
  // Antes de tudo, pega o que vem ANTES do primeiro separador " | ", " - ", " – "
  const beforeSep = baseNoParens.split(/\s+[|\-–—]\s+/)[0]?.trim();
  if (beforeSep) push(beforeSep);
  // corta em separadores (mais agressivo)
  const cuts = baseNoParens.split(/[|\-–—•/,()]/).map((s) => s.trim()).filter(Boolean);
  for (const c of cuts) push(c);
  // Remove sufixos comuns de bairro/rótulo que aparecem depois de "- "
  const suffixStrip = beforeSep ?? baseNoParens;
  push(suffixStrip.replace(/\b(centro|matriz|filial|unidade|sede|bairro)\b.*$/gi, "").trim());
  // remove cidade no final
  if (cidade) {
    const city = cleanName(cidade);
    const re = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "gi");
    push(baseNoParens.replace(re, ""));
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
    if (!res.ok) {
      // O corpo é onde a CNPJá explica o motivo: chave inválida, sem crédito,
      // parâmetro desconhecido ou plano que não inclui busca. Os params no
      // registro dizem qual das quatro buscas falhou.
      const corpo = await res.text().catch(() => "");
      registrarFalhaCnpja("busca", `HTTP ${res.status} · ${params.toString()} · ${corpo.slice(0, 250)}`);
      return [];
    }
    const json: any = await res.json();
    const records: any[] = Array.isArray(json?.records) ? json.records
      : Array.isArray(json?.data) ? json.data
      : Array.isArray(json) ? json : [];
    // Telefone é uma chave forte: se retorna 1 único registro, aceita mesmo fora da cidade
    // (DDD compartilhado às vezes mostra cidade vizinha). Se retornar 2+, filtra por cidade.
  if (!cidade || records.length <= 1) return records;
      const filtered = records.filter((r) => acceptCityMatch(cidade, r?.address?.city));
    return filtered.length > 0 ? filtered : [];
  } catch (e) {
    registrarFalhaCnpja("busca", `exceção: ${String(e).slice(0, 200)}`);
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
    if (!res.ok) {
      // O corpo é onde a CNPJá explica o motivo: chave inválida, sem crédito,
      // parâmetro desconhecido ou plano que não inclui busca. Os params no
      // registro dizem qual das quatro buscas falhou.
      const corpo = await res.text().catch(() => "");
      registrarFalhaCnpja("busca", `HTTP ${res.status} · ${params.toString()} · ${corpo.slice(0, 250)}`);
      return [];
    }
    const json: any = await res.json();
    const records: any[] = Array.isArray(json?.records) ? json.records
      : Array.isArray(json?.data) ? json.data
      : Array.isArray(json) ? json : [];
    if (!cidade) return records;
    return records.filter((r) => acceptCityMatch(cidade, r?.address?.city));
  } catch (e) {
    registrarFalhaCnpja("busca", `exceção: ${String(e).slice(0, 200)}`);
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
    if (!res.ok) {
      // O corpo é onde a CNPJá explica o motivo: chave inválida, sem crédito,
      // parâmetro desconhecido ou plano que não inclui busca. Os params no
      // registro dizem qual das quatro buscas falhou.
      const corpo = await res.text().catch(() => "");
      registrarFalhaCnpja("busca", `HTTP ${res.status} · ${params.toString()} · ${corpo.slice(0, 250)}`);
      return [];
    }
    const json: any = await res.json();
    const records: any[] = Array.isArray(json?.records) ? json.records
      : Array.isArray(json?.data) ? json.data
      : Array.isArray(json) ? json : [];
    if (!cidade) return records;
    return records.filter((r) => acceptCityMatch(cidade, r?.address?.city));
  } catch (e) {
    registrarFalhaCnpja("busca", `exceção: ${String(e).slice(0, 200)}`);
    return [];
  }
}

/**
 * Cascata completa: name → phone → CEP → district → SERP.
 * Retorna { detail, cnpj, strategy } ou null. Compartilhada por ingest e JIT.
 */
/**
 * Passo 0 da cascata: base local da Receita (`rfb_autoescolas` / `rfb_socios`).
 * Grátis, instantânea, sem rate limit e sem depender de buscador — que é
 * justamente o que derrubava o enriquecimento em produção. Devolve o payload no
 * formato da CNPJá para o restante do pipeline não precisar saber a diferença.
 */
async function findNaBaseLocal(
  nome: string,
  cidade: string | null,
  uf: string | null,
): Promise<{ detail: Record<string, unknown>; cnpj: string } | null> {
  if (!nome || !cidade) return null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // rfb_autoescolas e rfb_socios foram criadas fora do agente do Lovable, então
    // ainda não constam no types.ts gerado. Cast sem o genérico de schema em vez
    // de editar o arquivo gerado — que seria sobrescrito na próxima regeneração.
    const db = supabaseAdmin as unknown as SupabaseClient;
    let q = db
      .from("rfb_autoescolas")
      .select("cnpj,cnpj_basico,nome_fantasia,razao_social,cidade,uf,bairro,cep,telefone,ativa")
      .eq("cidade_norm", normCidade(cidade));
    const nUf = normalizeUf(uf);
    if (nUf) q = q.eq("uf", nUf);
    // Cidade grande chega a algumas centenas de autoescolas; cabe folgado.
    const { data, error } = await q.limit(1000);
    if (error || !data?.length) {
      // Distingue "a base não tem essa cidade carregada" de "tem e não casou".
      registrarFalhaCnpja(
        "baseLocal",
        error
          ? `erro ao consultar: ${error.message}`
          : `nenhuma autoescola carregada em ${cidade}/${uf ?? "?"}`,
      );
      return null;
    }

    const hit = matchAutoescola(nome, cidade, data as unknown as RfbEstab[]);
    if (!hit) return null;

    const { data: socios } = await db
      .from("rfb_socios")
      .select("cnpj_basico,nome,qualificacao")
      .eq("cnpj_basico", hit.estab.cnpj_basico);

    return {
      detail: toCnpjaShape(hit.estab, (socios ?? []) as unknown as RfbSocio[]),
      cnpj: hit.estab.cnpj,
    };
  } catch {
    // Base ainda não carregada ou tabela ausente: segue para a cascata externa.
    return null;
  }
}

async function cascadeFindCompany(row: {
  nome_fantasia?: string | null;
  cidade?: string | null;
  uf?: string | null;
  bairro?: string | null;
  endereco?: string | null;
  telefone_1?: string | null;
  telefone_2?: string | null;
}): Promise<{ detail: any; cnpj: string | null; strategy: "local" | "name" | "phone" | "cep" | "district" | "serp" } | null> {
  const hasPaid = !!process.env.CNPJA_API_KEY;
  const nome = row.nome_fantasia ?? "";
  const cidade = row.cidade ?? null;
  const uf = row.uf ?? null;

  // O guarda `hasPaid` abaixo pula as quatro buscas antes de qualquer
  // requisição sair. Sem registrar aqui, chave ausente no runtime fica
  // indistinguível de "a CNPJá respondeu e não achou".
  if (!hasPaid) {
    registrarFalhaCnpja("cascata", "CNPJA_API_KEY ausente no runtime — as 4 buscas foram puladas");
  }

  // 0) Base local da Receita — resolve a maioria antes de gastar chamada externa.
  if (nome) {
    const local = await findNaBaseLocal(nome, cidade, uf);
    if (local) return { detail: local.detail, cnpj: local.cnpj, strategy: "local" };
  }

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
  registrarFalhaCnpja(
    "cascata",
    `esgotou "${nome.slice(0, 40)}" em ${cidade ?? "?"}/${uf ?? "?"} · paga=${hasPaid}`,
  );
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

    // Limpa jobs órfãos (running > 10 min sem update) do próprio usuário.
    const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    await supabase.from("enrichment_jobs")
      .update({ status: "failed", error: "abandoned (stale)" })
      .eq("user_id", userId)
      .in("status", ["queued", "running"])
      .lt("updated_at", staleCutoff);

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
    // Filtro de categoria: quando o nicho é autoescola, descartar places
    // cujo categoryName/categories/title não indiquem autoescola/CFC.
    const nicheIsAutoescola = /autoescola|auto\s*escola|cfc|driving/i.test(job.niche ?? "");
    const isAutoescola = (p: any) => {
      const cats = [p.categoryName, ...(Array.isArray(p.categories) ? p.categories : [])]
        .filter(Boolean)
        .map((c: any) => String(c).toLowerCase());
      const title = String(p.title ?? p.name ?? "").toLowerCase();
      const hitCat = cats.some((c) =>
        c.includes("driving school") ||
        c.includes("autoescola") ||
        c.includes("auto escola") ||
        c.includes("auto-escola") ||
        c.includes("centro de formação") ||
        c.includes("centro de formacao"),
      );
      const hitTitle = /\bauto[\s-]*escola\b|\bcfc\b|centro de forma[cç][ãa]o/i.test(title);
      return hitCat || hitTitle;
    };
    const categoryFiltered = nicheIsAutoescola
      ? filteredItems.filter(isAutoescola)
      : filteredItems;
    const rejectedByCategory = filteredItems.length - categoryFiltered.length;
    const baseRows = categoryFiltered.map((p: any) => ({
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
      opening_hours: p.openingHours ?? null,
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

    return { ...job, status: "done", leads_created: created, rejected_category: rejectedByCategory };
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
      if (mapped && mapped.cidade && leadCidade && !acceptCityMatch(leadCidade, mapped.cidade)) {
        return "rejected";
      }
      const updates: Record<string, any> = {};
      if (cnpj) updates.cnpj = cnpj;
      if (mapped) {
        for (const [k, v] of Object.entries(mapped as any)) {
          if (k === "cnpj" || GEO_FIELDS.has(k)) continue;
          if (v != null && v !== "") updates[k] = v;
        }
        updates.enrichment_status = isInactivePayload(detail) ? "inactive" : "enriched";
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
      .order("created_at", { ascending: true })
      .limit(MAX_LEADS);

    let scanned = 0;
    let matched_by_name = 0;
    let matched_by_phone = 0;
    let matched_by_cep = 0;
    let matched_by_district = 0;
    let matched_by_serp = 0;
    let not_found = 0;

    // Processa em paralelo com concorrência limitada. CNPJá paga aguenta
    // vários RPS; ~5 em voo é seguro e multiplica ~5x a vazão por clique.
    const CONCURRENCY = 5;
    const queue = (noCnpj ?? []).filter((l) => l.nome_fantasia);
    const processOne = async (l: any) => {
      if (timeUp()) return;
      scanned++;
      let found: Awaited<ReturnType<typeof cascadeFindCompany>> = null;
      try { found = await cascadeFindCompany(l); } catch { /* ignore */ }
      const detail = found?.detail ?? null;
      const cnpj = found?.cnpj ?? null;
      const strategy = found?.strategy ?? null;

      if (detail) {
        const res = await applyUpdates(l.id, l.cidade ?? null, cnpj, detail);
        if (res === "applied") {
          if (strategy === "name") matched_by_name++;
          else if (strategy === "phone") matched_by_phone++;
          else if (strategy === "cep") matched_by_cep++;
          else if (strategy === "district") matched_by_district++;
          else if (strategy === "serp") matched_by_serp++;
        } else if (res === "rejected") {
          await supabase.from("leads").update({ enrichment_status: "not_found" }).eq("id", l.id);
          not_found++;
        }
      } else if (cnpj) {
        await supabase.from("leads").update({ cnpj }).eq("id", l.id);
      } else {
        await supabase.from("leads").update({ enrichment_status: "not_found" }).eq("id", l.id);
        not_found++;
      }
    };

    let cursor = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < queue.length && !timeUp()) {
        const idx = cursor++;
        await processOne(queue[idx]);
      }
    });
    await Promise.all(workers);

    // Quantos leads ainda restam para próximos lotes (mesma seleção da fila)
    const { count: remainingCount } = await supabase
      .from("leads").select("*", { count: "exact", head: true })
      .is("cnpj", null).is("socios", null)
      .or("enrichment_status.is.null,enrichment_status.eq.retry");

    let inactive = 0;
    // conta rápida dos que viraram inactive nesse lote não é necessária;
    // preferimos expor o total geral pela UI ao invés de derivar aqui.

    // Persiste o que a CNPJá respondeu neste lote. Se ela recusou, o motivo
    // fica em public.diagnosticos em vez de virar mais um not_found silencioso.
    await gravarDiagnostico("enrichMissingSocios");

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
      processed: scanned,
      remaining: remainingCount ?? 0,
      inactive,
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
    if (found.strategy !== "phone" && mapped.cidade && (lead as any).cidade && !acceptCityMatch((lead as any).cidade, mapped.cidade)) {
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