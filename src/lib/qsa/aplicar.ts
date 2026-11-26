import type { ResultadoQsa } from "./types";

/** Campos do lead que o QSA lê ou escreve. */
export type LeadParaQsa = {
  cnpj: string | null;
  proprietario: string | null;
  email: string | null;
  razao_social: string | null;
  capital_social: number | null;
  data_abertura: string | null;
  qsa: unknown;
};

export type AtualizacaoLead = Record<string, unknown> & { enrichment_status: string };

type QsaGravado = { proprietario_auto?: string | null; tentativas_de_rede?: number };

/** Depois disto, uma falha de rede insistente vira `not_found` em vez de `retry` eterno. */
export const MAX_TENTATIVAS_DE_REDE = 5;

/**
 * Transforma o resultado da verificação nas colunas do lead.
 *
 * Regras que protegem o trabalho do SDR:
 *  - nunca mexe em cidade, UF, bairro nem endereço (a geografia vem do Maps);
 *  - só grava dono, sócios e CNPJ quando a confiança é média ou alta;
 *  - não sobrescreve um `proprietario` digitado à mão no Modo Foco: só troca o
 *    que o próprio QSA gravou antes;
 *  - falha de rede vira `retry`, não `not_found`, para o lead voltar à fila.
 *
 * Sempre grava o laudo em `qsa`, inclusive quando a confiança é baixa, para você
 * ver o candidato e decidir. Só não promove ele a dono.
 */
export function montarAtualizacaoLead(
  lead: LeadParaQsa,
  r: ResultadoQsa,
  agora: Date = new Date(),
): AtualizacaoLead {
  const anterior = (lead.qsa && typeof lead.qsa === "object" ? (lead.qsa as QsaGravado) : {}) ?? {};
  const falhouRede = r.tentativas.some((t) => t.resultado === "erro" || t.resultado === "limite");

  const laudo = {
    versao: 1,
    verificado_em: agora.toISOString(),
    estrategia: r.estrategia,
    fonte: r.empresa?.fonte ?? null,
    confianca: r.confianca,
    nivel: r.nivel,
    verificacoes: r.verificacoes,
    alertas: r.alertas,
    decisor: r.decisor,
    outros_socios: r.outrosSocios.slice(0, 5),
    empresa: r.empresa
      ? { cnpj: r.empresa.cnpj, razao_social: r.empresa.razaoSocial, situacao: r.empresa.situacao }
      : null,
    tentativas: r.tentativas,
    proprietario_auto: anterior.proprietario_auto ?? null,
    tentativas_de_rede: (anterior.tentativas_de_rede ?? 0) + (falhouRede ? 1 : 0),
  };

  if (!r.encontrado || !r.empresa) {
    const esgotou = laudo.tentativas_de_rede >= MAX_TENTATIVAS_DE_REDE;
    return {
      qsa: laudo,
      enrichment_status: falhouRede && !esgotou ? "retry" : "not_found",
    };
  }

  if (r.nivel === "baixa") {
    // Candidato duvidoso: fica no laudo, não vira dono.
    return { qsa: laudo, enrichment_status: "not_found" };
  }

  const e = r.empresa;
  const up: AtualizacaoLead = {
    enrichment_status: e.situacao === "ativa" || e.situacao === "desconhecida" ? "enriched" : "inactive",
    qsa: laudo,
  };

  if (!lead.cnpj) up.cnpj = e.cnpj;
  if (e.razaoSocial && !lead.razao_social) up.razao_social = e.razaoSocial;
  if (e.capitalSocial != null && lead.capital_social == null) up.capital_social = e.capitalSocial;
  if (e.dataAbertura && !lead.data_abertura) up.data_abertura = e.dataAbertura;
  if (e.email && !lead.email) up.email = e.email;

  if (e.socios.length) {
    up.socios = e.socios.map((s) => ({ nome: s.nome, qualificacao: s.qualificacao }));
  }

  if (r.decisor) {
    const digitadoPeloSdr = !!lead.proprietario && lead.proprietario !== anterior.proprietario_auto;
    if (!digitadoPeloSdr) {
      up.proprietario = r.decisor.nome;
      laudo.proprietario_auto = r.decisor.nome;
    }
  }
  return up;
}
