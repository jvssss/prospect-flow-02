import { cnpjValido, soDigitos } from "./verify";
import type { Empresa, SituacaoCadastral, Socio } from "./types";

/**
 * Fontes gratuitas de CNPJ, usadas só como reserva da base local.
 *
 * Nenhuma delas é "sem limite" por contrato, então cada uma tem um cooldown
 * próprio: ao levar 429 ou erro de servidor, ela sai de cena por um tempo e a
 * próxima assume. Quem chama nunca fica esperando uma fonte que já recusou.
 */

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; motivo: "vazio" | "erro" | "limite"; detalhe: string };

type Provider = {
  nome: "brasilapi" | "minhareceita" | "cnpja_open";
  url: (cnpj: string) => string;
  mapear: (json: any) => Empresa | null;
};

const UA = "prospect-flow/1.0 (+enriquecimento de leads)";

// ---------------------------------------------------------------------------
// Mapeamento
// ---------------------------------------------------------------------------

function situacaoPorCodigo(c: number | string | null | undefined): SituacaoCadastral {
  switch (Number(c)) {
    case 1:
      return "nula";
    case 2:
      return "ativa";
    case 3:
      return "suspensa";
    case 4:
      return "inapta";
    case 8:
      return "baixada";
    default:
      return "desconhecida";
  }
}

function situacaoPorTexto(t: string | null | undefined): SituacaoCadastral {
  const s = (t ?? "").toLowerCase();
  if (!s) return "desconhecida";
  if (s.includes("baixad")) return "baixada";
  if (s.includes("inapt")) return "inapta";
  if (s.includes("suspens")) return "suspensa";
  if (s.includes("nula")) return "nula";
  if (s.includes("ativ")) return "ativa";
  return "desconhecida";
}

function tipoSocio(id: unknown): Socio["tipo"] {
  return id === 1 ? "PJ" : id === 2 ? "PF" : id === 3 ? "EX" : null;
}

/** BrasilAPI e Minha Receita devolvem o mesmo formato. */
function mapearFormatoBrasilApi(fonte: "brasilapi" | "minhareceita") {
  return (j: any): Empresa | null => {
    const cnpj = soDigitos(j?.cnpj);
    if (cnpj.length !== 14) return null;
    const qsa: any[] = Array.isArray(j?.qsa) ? j.qsa : [];
    return {
      cnpj,
      razaoSocial: j.razao_social || null,
      nomeFantasia: j.nome_fantasia || null,
      situacao: j.situacao_cadastral != null ? situacaoPorCodigo(j.situacao_cadastral) : situacaoPorTexto(j.descricao_situacao_cadastral),
      capitalSocial: j.capital_social != null ? Number(j.capital_social) : null,
      dataAbertura: j.data_inicio_atividade || null,
      cidade: j.municipio || null,
      uf: j.uf || null,
      bairro: j.bairro || null,
      cep: j.cep ? String(j.cep) : null,
      telefone: j.ddd_telefone_1 ? soDigitos(j.ddd_telefone_1) : null,
      email: j.email || null,
      socios: qsa
        .map((q) => ({
          nome: String(q?.nome_socio ?? "").trim(),
          qualificacao: q?.qualificacao_socio || null,
          tipo: tipoSocio(q?.identificador_de_socio),
          desde: q?.data_entrada_sociedade || null,
        }))
        .filter((s) => s.nome),
      fonte,
    };
  };
}

function mapearCnpjaOpen(j: any): Empresa | null {
  const cnpj = soDigitos(j?.taxId);
  if (cnpj.length !== 14) return null;
  const membros: any[] = Array.isArray(j?.company?.members) ? j.company.members : [];
  const fone = Array.isArray(j?.phones) ? j.phones[0] : null;
  return {
    cnpj,
    razaoSocial: j?.company?.name || null,
    nomeFantasia: j?.alias || null,
    situacao: situacaoPorTexto(j?.status?.text),
    capitalSocial: j?.company?.equity != null ? Number(j.company.equity) : null,
    dataAbertura: j?.founded || null,
    cidade: j?.address?.city || null,
    uf: j?.address?.state || null,
    bairro: j?.address?.district || null,
    cep: j?.address?.zip ? String(j.address.zip) : null,
    telefone: fone?.area && fone?.number ? `${fone.area}${fone.number}` : null,
    email: Array.isArray(j?.emails) && j.emails[0]?.address ? j.emails[0].address : null,
    socios: membros
      .map((m) => ({
        nome: String(m?.person?.name ?? "").trim(),
        qualificacao: m?.role?.text || null,
        tipo: (m?.person?.type === "LEGAL" ? "PJ" : m?.person?.type === "NATURAL" ? "PF" : null) as Socio["tipo"],
        desde: m?.since || null,
      }))
      .filter((s) => s.nome),
    fonte: "cnpja_open",
  };
}

export const PROVIDERS: Provider[] = [
  {
    nome: "brasilapi",
    url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`,
    mapear: mapearFormatoBrasilApi("brasilapi"),
  },
  {
    nome: "minhareceita",
    url: (c) => `https://minhareceita.org/${c}`,
    mapear: mapearFormatoBrasilApi("minhareceita"),
  },
  {
    nome: "cnpja_open",
    url: (c) => `https://open.cnpja.com/office/${c}`,
    mapear: mapearCnpjaOpen,
  },
];

// ---------------------------------------------------------------------------
// Cooldown por fonte
// ---------------------------------------------------------------------------

const bloqueadoAte = new Map<string, number>();

export function fonteEmCooldown(nome: string, agora = Date.now()): boolean {
  return (bloqueadoAte.get(nome) ?? 0) > agora;
}

export function colocarEmCooldown(nome: string, ms: number, agora = Date.now()) {
  bloqueadoAte.set(nome, agora + ms);
}

export function limparCooldowns() {
  bloqueadoAte.clear();
}

async function fetchComTimeout(url: string, ms: number, fetchImpl: typeof fetch): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": UA },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export type OpcoesBusca = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Para testes: lista de fontes a usar, na ordem. */
  providers?: Provider[];
};

export type Tentativa = { fonte: string; resultado: "ok" | "vazio" | "erro" | "limite"; detalhe?: string };

/**
 * Consulta o CNPJ nas fontes gratuitas, na ordem, até uma responder.
 * Devolve também o histórico de tentativas, para o motivo de uma falha nunca
 * virar um "não encontrado" mudo.
 */
export async function buscarCnpjGratis(
  cnpjBruto: string,
  opcoes: OpcoesBusca = {},
): Promise<{ empresa: Empresa | null; tentativas: Tentativa[] }> {
  const cnpj = soDigitos(cnpjBruto);
  const tentativas: Tentativa[] = [];
  if (!cnpjValido(cnpj)) {
    return { empresa: null, tentativas: [{ fonte: "validacao", resultado: "erro", detalhe: "CNPJ inválido." }] };
  }
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const timeout = opcoes.timeoutMs ?? 9000;

  for (const p of opcoes.providers ?? PROVIDERS) {
    if (fonteEmCooldown(p.nome)) {
      tentativas.push({ fonte: p.nome, resultado: "limite", detalhe: "em pausa após recusar uma consulta." });
      continue;
    }
    try {
      const res = await fetchComTimeout(p.url(cnpj), timeout, fetchImpl);
      if (res.status === 429) {
        const espera = Number(res.headers.get("retry-after"));
        colocarEmCooldown(p.nome, (Number.isFinite(espera) && espera > 0 ? Math.min(espera, 300) : 60) * 1000);
        tentativas.push({ fonte: p.nome, resultado: "limite", detalhe: "HTTP 429" });
        continue;
      }
      if (res.status === 404) {
        // 404 é resposta definitiva da fonte: o CNPJ não existe ali. Não é falha.
        tentativas.push({ fonte: p.nome, resultado: "vazio", detalhe: "HTTP 404" });
        continue;
      }
      if (!res.ok) {
        if (res.status >= 500) colocarEmCooldown(p.nome, 30_000);
        tentativas.push({ fonte: p.nome, resultado: "erro", detalhe: `HTTP ${res.status}` });
        continue;
      }
      const empresa = p.mapear(await res.json());
      if (!empresa || empresa.cnpj !== cnpj) {
        tentativas.push({ fonte: p.nome, resultado: "vazio", detalhe: "resposta sem dados utilizáveis" });
        continue;
      }
      tentativas.push({ fonte: p.nome, resultado: "ok" });
      return { empresa, tentativas };
    } catch (e) {
      colocarEmCooldown(p.nome, 15_000);
      tentativas.push({ fonte: p.nome, resultado: "erro", detalhe: String((e as Error)?.message ?? e).slice(0, 120) });
    }
  }
  return { empresa: null, tentativas };
}
