import { coreTokens, dice, normCidade } from "@/lib/rfb-match";
import type {
  Decisor,
  Empresa,
  EntradaLead,
  NivelConfianca,
  Socio,
  Verificacao,
} from "./types";

// ---------------------------------------------------------------------------
// CNPJ
// ---------------------------------------------------------------------------

export function soDigitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}

/** Valida os dois dígitos verificadores. */
export function cnpjValido(raw: string | null | undefined): boolean {
  const c = soDigitos(raw);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string) => {
    const pesos =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12));
  const d2 = calc(c.slice(0, 12) + d1);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

// ---------------------------------------------------------------------------
// Decisor
// ---------------------------------------------------------------------------

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Quanto mais alto, mais provável que a pessoa atenda e decida.
 * Sócio-administrador manda; sócio sem poder de gestão fica atrás; procurador
 * e contador, que às vezes aparecem no QSA, ficam no fim.
 */
export function pesoQualificacao(q: string | null | undefined): number {
  const t = semAcento(q ?? "");
  if (!t) return 20;
  if (t.includes("socio-administrador") || t.includes("socio administrador")) return 100;
  if (t.includes("administrador")) return 92;
  if (t.includes("presidente")) return 90;
  if (t.includes("diretor")) return 88;
  if (t.includes("titular") || t.includes("empresario")) return 85;
  if (t.includes("socio gerente") || t.includes("socio-gerente") || t.includes("gerente")) return 80;
  if (t.includes("socio") && t.includes("proprietario")) return 78;
  if (t.includes("socio")) return 60;
  if (t.includes("conselheiro")) return 45;
  if (t.includes("procurador") || t.includes("mandatario")) return 25;
  return 30;
}

/** Sócio que é empresa não atende telefone: nome com cara de PJ não vale como decisor. */
export function pareceEmpresa(nome: string): boolean {
  return /\b(ltda|s\.?\s?a\.?|eireli|epp|me|holding|participacoes|empreendimentos|administradora|comercio|servicos)\b/i.test(
    semAcento(nome),
  );
}

export function ordenarSocios(socios: Socio[]): Socio[] {
  return socios
    .filter((s) => s.nome && s.tipo !== "PJ" && !pareceEmpresa(s.nome))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const dp = pesoQualificacao(b.s.qualificacao) - pesoQualificacao(a.s.qualificacao);
      if (dp !== 0) return dp;
      // Empate: o mais antigo na sociedade costuma ser o fundador.
      const da = a.s.desde ?? "9999";
      const db = b.s.desde ?? "9999";
      if (da !== db) return da < db ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.s);
}

export function escolherDecisor(socios: Socio[]): { decisor: Decisor | null; outros: Socio[] } {
  const ordenados = ordenarSocios(socios);
  if (!ordenados.length) return { decisor: null, outros: [] };
  const [top, ...outros] = ordenados;
  const peso = pesoQualificacao(top.qualificacao);
  const motivo =
    peso >= 100
      ? "Sócio-administrador: quem responde legalmente pela empresa."
      : peso >= 85
        ? `${top.qualificacao ?? "Gestor"}: tem poder de decisão.`
        : peso >= 60
          ? "Sócio sem cargo de gestão informado; confirme na ligação."
          : "Sem sócio-administrador identificado; é o melhor candidato disponível.";
  return { decisor: { nome: top.nome, qualificacao: top.qualificacao, motivo }, outros };
}

// ---------------------------------------------------------------------------
// Cidade e telefone
// ---------------------------------------------------------------------------

/** Regiões metropolitanas: lead e CNPJ podem estar em cidades vizinhas sem ser erro. */
const CONURBACOES: string[][] = [
  ["IPATINGA", "CORONEL FABRICIANO", "TIMOTEO", "SANTANA DO PARAISO"],
  ["BELO HORIZONTE", "CONTAGEM", "BETIM", "NOVA LIMA", "SANTA LUZIA", "RIBEIRAO DAS NEVES", "SABARA", "VESPASIANO", "IBIRITE"],
  ["VITORIA", "VILA VELHA", "SERRA", "CARIACICA", "VIANA", "GUARAPARI"],
  ["SAO PAULO", "GUARULHOS", "OSASCO", "SANTO ANDRE", "SAO BERNARDO DO CAMPO", "SAO CAETANO DO SUL", "DIADEMA", "MAUA", "RIBEIRAO PIRES", "TABOAO DA SERRA", "BARUERI", "COTIA", "CARAPICUIBA", "EMBU DAS ARTES", "ITAPECERICA DA SERRA", "SUZANO", "MOGI DAS CRUZES", "ITAQUAQUECETUBA"],
  ["SANTOS", "SAO VICENTE", "GUARUJA", "PRAIA GRANDE", "CUBATAO", "BERTIOGA"],
  ["RIO DE JANEIRO", "NITEROI", "SAO GONCALO", "DUQUE DE CAXIAS", "NOVA IGUACU", "BELFORD ROXO", "SAO JOAO DE MERITI", "NILOPOLIS", "QUEIMADOS", "MESQUITA", "MAGE", "ITAGUAI"],
  ["BRASILIA", "AGUAS CLARAS", "TAGUATINGA", "CEILANDIA", "GAMA", "SOBRADINHO", "PLANALTINA", "SAMAMBAIA", "RECANTO DAS EMAS", "SANTA MARIA", "RIACHO FUNDO"],
  ["CURITIBA", "SAO JOSE DOS PINHAIS", "COLOMBO", "PINHAIS", "ARAUCARIA", "FAZENDA RIO GRANDE"],
  ["PORTO ALEGRE", "CANOAS", "NOVO HAMBURGO", "SAO LEOPOLDO", "GRAVATAI", "VIAMAO", "CACHOEIRINHA", "ALVORADA", "ESTEIO", "SAPUCAIA DO SUL"],
  ["GOIANIA", "APARECIDA DE GOIANIA", "SENADOR CANEDO", "TRINDADE", "GOIANESIA"],
];

export type ConfereCidade = "igual" | "regiao" | "diferente" | "desconhecida";

export function compararCidades(a: string | null | undefined, b: string | null | undefined): ConfereCidade {
  const na = normCidade(a);
  const nb = normCidade(b);
  if (!na || !nb) return "desconhecida";
  if (na === nb) return "igual";
  for (const g of CONURBACOES) if (g.includes(na) && g.includes(nb)) return "regiao";
  return "diferente";
}

/** DDD + número, sem 55 nem zero à esquerda; null se não parecer telefone brasileiro. */
export function normalizarTelefone(s: string | null | undefined): string | null {
  let d = soDigitos(s);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0") && d.length >= 11) d = d.slice(1);
  return d.length === 10 || d.length === 11 ? d : null;
}

/** Compara pelos 8 últimos dígitos: ignora o nono dígito e o DDD digitado errado. */
export function telefonesIguais(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizarTelefone(a);
  const nb = normalizarTelefone(b);
  if (!na || !nb) return false;
  return na.slice(-8) === nb.slice(-8);
}

// ---------------------------------------------------------------------------
// Nome
// ---------------------------------------------------------------------------

/** 0..1: quanto o nome do lead (Google Maps) se parece com a empresa da Receita. */
export function similaridadeNome(lead: EntradaLead, empresa: Empresa): number {
  const base = coreTokens(lead.nomeFantasia, lead.cidade ?? empresa.cidade).join(" ");
  if (!base) return 0;
  let melhor = 0;
  for (const alvo of [empresa.nomeFantasia, empresa.razaoSocial]) {
    const t = coreTokens(alvo, lead.cidade ?? empresa.cidade).join(" ");
    if (t) melhor = Math.max(melhor, dice(base, t));
  }
  return melhor;
}

// ---------------------------------------------------------------------------
// Nota de confiança
// ---------------------------------------------------------------------------

export type Avaliacao = {
  confianca: number;
  nivel: NivelConfianca;
  verificacoes: Verificacao[];
  alertas: string[];
};

/**
 * Soma pontos por evidência independente. Nenhuma checagem sozinha dá "alta":
 * o objetivo é que um decisor errado nunca pareça seguro.
 *
 *   nome confere     40   (o que mais separa uma empresa de outra)
 *   cidade confere   25
 *   empresa ativa    15
 *   telefone confere 10   (chave forte; também compensa nome de fachada ruidoso)
 *   tem decisor PF   10
 */
export function avaliar(
  lead: EntradaLead,
  empresa: Empresa | null,
  opcoes: { /** Já comparado pelo matchAutoescola; evita recalcular com outra régua. */ similaridade?: number } = {},
): Avaliacao {
  const verificacoes: Verificacao[] = [];
  const alertas: string[] = [];
  if (!empresa) {
    return {
      confianca: 0,
      nivel: "baixa",
      verificacoes: [{ id: "cnpj_valido", ok: null, detalhe: "Nenhuma empresa encontrada." }],
      alertas: ["Empresa não encontrada."],
    };
  }

  let pontos = 0;

  const valido = cnpjValido(empresa.cnpj);
  verificacoes.push({
    id: "cnpj_valido",
    ok: valido,
    detalhe: valido ? "Dígitos verificadores corretos." : "CNPJ com dígito verificador inválido.",
  });
  if (!valido) alertas.push("CNPJ inválido: descarte este resultado.");

  const ativa = empresa.situacao === "ativa";
  verificacoes.push({
    id: "empresa_ativa",
    ok: empresa.situacao === "desconhecida" ? null : ativa,
    detalhe: `Situação cadastral: ${empresa.situacao}.`,
  });
  if (ativa) pontos += 15;
  else if (empresa.situacao !== "desconhecida")
    alertas.push(`Empresa ${empresa.situacao}: provavelmente não atende telefone.`);

  const sim = opcoes.similaridade ?? similaridadeNome(lead, empresa);
  const nomeOk = sim >= 0.55;
  verificacoes.push({
    id: "nome_confere",
    ok: lead.nomeFantasia ? nomeOk : null,
    detalhe: lead.nomeFantasia
      ? `Semelhança de nome com a Receita: ${Math.round(sim * 100)}%.`
      : "Lead sem nome para comparar.",
  });
  pontos += Math.round(40 * Math.min(1, sim / 0.8));
  if (lead.nomeFantasia && !nomeOk) alertas.push("O nome da empresa na Receita é pouco parecido com o do lead.");

  const cid = compararCidades(lead.cidade, empresa.cidade);
  verificacoes.push({
    id: "cidade_confere",
    ok: cid === "desconhecida" ? null : cid !== "diferente",
    detalhe:
      cid === "igual"
        ? "Mesma cidade."
        : cid === "regiao"
          ? `Cidades da mesma região metropolitana (${lead.cidade} / ${empresa.cidade}).`
          : cid === "diferente"
            ? `Cidade diferente: lead em ${lead.cidade}, Receita em ${empresa.cidade}.`
            : "Cidade não informada.",
  });
  if (cid === "igual") pontos += 25;
  else if (cid === "regiao") pontos += 15;
  else if (cid === "diferente") alertas.push("A empresa está em outra cidade: pode ser homônimo.");

  const tel = [lead.telefone1, lead.telefone2].some((t) => telefonesIguais(t, empresa.telefone));
  const temTelefone = !!normalizarTelefone(empresa.telefone) && [lead.telefone1, lead.telefone2].some((t) => normalizarTelefone(t));
  verificacoes.push({
    id: "telefone_confere",
    ok: temTelefone ? tel : null,
    detalhe: tel ? "Telefone do lead bate com o da Receita." : temTelefone ? "Telefone diferente do cadastro da Receita." : "Sem telefone para comparar.",
  });
  if (tel) pontos += 10;
  else if (temTelefone)
    alertas.push(
      "O telefone do lead difere do cadastro da Receita: pode ser outra empresa com o mesmo nome, ou cadastro desatualizado.",
    );

  const { decisor } = escolherDecisor(empresa.socios);
  verificacoes.push({
    id: "tem_decisor",
    ok: !!decisor,
    detalhe: decisor ? `${decisor.nome} (${decisor.qualificacao ?? "sem qualificação"}).` : "Nenhum sócio pessoa física no QSA.",
  });
  if (decisor) pontos += 10;
  else alertas.push("QSA sem pessoa física identificável (sócio é empresa ou o QSA veio vazio).");

  // Telefone igual é prova independente: sustenta um nome de fachada diferente.
  if (tel && !nomeOk) pontos += 15;

  let confianca = Math.max(0, Math.min(100, pontos));
  if (!valido) confianca = Math.min(confianca, 10);
  if (cid === "diferente") confianca = Math.min(confianca, 54);
  // Nome igual + telefone diferente é exatamente o caso do homônimo: não pode ser "alta".
  if (temTelefone && !tel) confianca = Math.min(confianca, 79);

  const nivel: NivelConfianca = confianca >= 80 ? "alta" : confianca >= 55 ? "media" : "baixa";
  return { confianca, nivel, verificacoes, alertas };
}
