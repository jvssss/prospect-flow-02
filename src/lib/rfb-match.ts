/**
 * Casamento de leads do Google Maps contra a base de autoescolas da Receita
 * Federal (CNAE 8599-6-01), carregada localmente em `rfb_autoescolas` /
 * `rfb_socios`.
 *
 * Sem I/O de propósito: os candidatos entram por parâmetro, então a lógica é
 * testável isoladamente e roda igual no servidor ou num script.
 *
 * O problema que isto resolve: o Maps devolve nome de fachada
 * ("Auto Escola FAMA - Vila Celeste") e a Receita guarda razão social
 * ("CENTRO DE FORMACAO DE CONDUTORES FAMA LTDA"). O que liga os dois é o
 * núcleo distintivo do nome — FAMA — dentro da mesma cidade.
 */

export type RfbEstab = {
  cnpj: string;
  cnpj_basico: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  cep: string | null;
  telefone: string | null;
  ativa: boolean;
};

export type RfbSocio = {
  cnpj_basico: string;
  nome: string;
  qualificacao: string | null;
};

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s: string | null | undefined) =>
  strip(String(s ?? ""))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Sinônimos do nicho. Todos descartados: não distinguem uma autoescola de outra. */
const NICHE = [
  "CENTRO DE FORMACAO DE CONDUTORES",
  "CENTRO DE FORMACOES DE CONDUTORES",
  "ESCOLA DE CONDUTORES",
  "FORMACAO DE CONDUTORES",
  "AUTO MOTO ESCOLA",
  "AUTO ESCOLA",
  "AUTOESCOLA",
  "MOTO ESCOLA",
  "C F C",
  "CFC",
];

const STOP = new Set([
  "LTDA",
  "ME",
  "EPP",
  "EIRELI",
  "EIRELLI",
  "SA",
  "S",
  "A",
  "DE",
  "DA",
  "DO",
  "DOS",
  "DAS",
  "E",
  "EM",
  "O",
  "OS",
  "AS",
  "SUA",
  "PERTO",
  "VOCE",
  "REGIAO",
  "UNIDADE",
  "FILIAL",
  "MATRIZ",
  "CENTRO",
  "LOJA",
  "AB",
  "B",
  "BC",
  "EAD",
  "CNH",
  "INSTRUTOR",
  "INSTRUTORA",
  "AUTONOMO",
  "AUTONOMA",
  "PISTA",
  "TREINAMENTO",
  "PATIO",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
]);

/**
 * Sobrenomes comuns. Sem esta lista, "Auto Escola Martins" casa com
 * "Auto Escola Status" só porque o sócio se chama Eduardo de Assis MARTINS —
 * e um decisor errado na ligação é pior que decisor nenhum.
 */
const SOBRENOMES = new Set([
  "SILVA",
  "SANTOS",
  "SOUZA",
  "SOUSA",
  "OLIVEIRA",
  "PEREIRA",
  "LIMA",
  "CARVALHO",
  "FERREIRA",
  "RODRIGUES",
  "ALVES",
  "GOMES",
  "MARTINS",
  "ROCHA",
  "RIBEIRO",
  "ARAUJO",
  "COSTA",
  "BARBOSA",
  "NASCIMENTO",
  "MOREIRA",
  "CARDOSO",
  "TEIXEIRA",
  "CORREA",
  "DIAS",
  "VIEIRA",
  "MENDES",
  "FREITAS",
  "MACHADO",
  "MELO",
  "BARROS",
  "MONTEIRO",
  "CAMPOS",
  "REIS",
  "NUNES",
  "AZEVEDO",
  "CUNHA",
  "PINTO",
  "JUNIOR",
  "NETO",
  "FILHO",
]);

/**
 * Chave de cidade. A Receita grava "APARECIDA DE GOIANIA" e o Google Maps
 * "Aparecida de Goiânia" — sem normalizar dos dois lados, nenhum ilike casa.
 * Esta função é a MESMA usada no carregador da base; se mudar aqui, recarregue.
 */
export function normCidade(cidade: string | null | undefined): string {
  return norm(cidade);
}

/** Núcleo distintivo: tira nicho, cidade, sufixos societários e rótulos de unidade. */
export function coreTokens(
  nome: string | null | undefined,
  cidade: string | null | undefined,
): string[] {
  let s = norm(nome);
  for (const p of NICHE) s = s.split(p).join(" ");
  const cityTokens = new Set(norm(cidade).split(" ").filter(Boolean));
  return s.split(" ").filter((t) => t && t.length > 1 && !STOP.has(t) && !cityTokens.has(t));
}

function bigrams(s: string): Set<string> {
  const g = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
}

/** Coeficiente de Dice sobre bigramas — mesma família do pg_trgm. */
export function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const g of A) if (B.has(g)) n++;
  return (2 * n) / (A.size + B.size);
}

export type RfbMatch = {
  estab: RfbEstab;
  score: number;
  sim: number;
  /** Tokens raros em comum que sustentaram o casamento. */
  strong: string[];
};

/**
 * Escolhe a autoescola da Receita que corresponde ao lead.
 * `candidatos` já deve vir filtrado pela cidade do lead.
 */
export function matchAutoescola(
  nome: string | null | undefined,
  cidade: string | null | undefined,
  candidatos: RfbEstab[],
): RfbMatch | null {
  if (!candidatos.length) return null;
  const lc = coreTokens(nome, cidade);
  // Nome que é só nicho + cidade ("Autoescola Curvelo") não tem o que comparar.
  if (!lc.length) return null;
  const lcs = lc.join(" ");

  // Raridade do token na cidade, contada por CNPJ raiz. Contar por
  // estabelecimento faria uma rede com 4 filiais parecer genérica, quando na
  // verdade as 4 são a mesma empresa e têm os mesmos sócios.
  const porBase = new Map<string, Set<string>>();
  for (const r of candidatos) {
    const toks = new Set([
      ...coreTokens(r.nome_fantasia, cidade),
      ...coreTokens(r.razao_social, cidade),
    ]);
    for (const t of toks) {
      let s = porBase.get(t);
      if (!s) porBase.set(t, (s = new Set()));
      s.add(r.cnpj_basico);
    }
  }

  let best: RfbMatch | null = null;
  for (const r of candidatos) {
    for (const val of [r.nome_fantasia, r.razao_social]) {
      if (!val) continue;
      const rc = coreTokens(val, cidade);
      if (!rc.length) continue;
      const sim = dice(lcs, rc.join(" "));
      const strong = lc.filter(
        (t) =>
          rc.includes(t) && (porBase.get(t)?.size ?? 0) <= 3 && !SOBRENOMES.has(t) && t.length >= 3,
      );
      let score = strong.length ? 0.62 + 0.38 * sim : sim;
      if (!r.ativa) score -= 0.05; // empresa ativa ganha o desempate
      if (!best || score > best.score) best = { estab: r, score, sim, strong };
    }
  }
  if (!best) return null;
  return best.strong.length > 0 || best.sim >= 0.7 ? best : null;
}

/** Códigos de qualificação do QSA que aparecem em autoescola. */
const QUALIFICACAO: Record<string, string> = {
  "05": "Administrador",
  "08": "Conselheiro de Administração",
  "10": "Diretor",
  "16": "Presidente",
  "22": "Sócio",
  "49": "Sócio-Administrador",
  "65": "Titular Pessoa Física",
};

/**
 * Converte um registro da Receita no formato de payload da CNPJá, para que o
 * resto do pipeline (`mapCnpja` / `mergeCnpjaOntoRow`) funcione sem alteração.
 */
export function toCnpjaShape(estab: RfbEstab, socios: RfbSocio[]): Record<string, unknown> {
  const ddd = estab.telefone?.slice(0, 2) ?? null;
  const numero = estab.telefone && estab.telefone.length > 2 ? estab.telefone.slice(2) : null;
  return {
    taxId: estab.cnpj,
    alias: estab.nome_fantasia,
    status: { text: estab.ativa ? "Ativa" : "Baixada" },
    company: {
      name: estab.razao_social,
      members: socios.map((s) => ({
        person: { name: s.nome },
        role: { text: s.qualificacao ? (QUALIFICACAO[s.qualificacao] ?? null) : null },
      })),
    },
    address: {
      city: estab.cidade,
      state: estab.uf,
      district: estab.bairro,
    },
    phones: ddd && numero ? [{ area: ddd, number: numero }] : [],
    emails: [],
  };
}
