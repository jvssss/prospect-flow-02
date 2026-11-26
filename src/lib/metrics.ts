import { computeGoldenNumbers, type GoalsInput, type GoldenNumbers } from "./goldenMath";

export type Totais = {
  calls_made: number;
  decisions_reached: number;
  meetings_scheduled: number;
  meetings_held: number;
  closes: number;
  revenue: number;
};

export const TOTAIS_ZERO: Totais = {
  calls_made: 0,
  decisions_reached: 0,
  meetings_scheduled: 0,
  meetings_held: 0,
  closes: 0,
  revenue: 0,
};

export function somar(linhas: Partial<Totais>[]): Totais {
  const t = { ...TOTAIS_ZERO };
  for (const l of linhas) {
    t.calls_made += l.calls_made ?? 0;
    t.decisions_reached += l.decisions_reached ?? 0;
    t.meetings_scheduled += l.meetings_scheduled ?? 0;
    t.meetings_held += l.meetings_held ?? 0;
    t.closes += l.closes ?? 0;
    t.revenue += Number(l.revenue ?? 0);
  }
  return t;
}

export type Etapa = "ligacao_decisor" | "decisor_reuniao" | "show_up" | "reuniao_fechamento";

export type AjusteEtapa = {
  etapa: Etapa;
  estimado: number;
  real: number | null;
  amostra: number;
  /** Taxa recomendada: mistura estimada e real, pesando mais o real conforme a amostra cresce. */
  sugerido: number;
  confianca: "insuficiente" | "baixa" | "media" | "alta";
  mensagem: string;
};

/** Amostra mínima de cada etapa para a taxa real começar a pesar. */
const MIN_AMOSTRA: Record<Etapa, number> = {
  ligacao_decisor: 30,
  decisor_reuniao: 15,
  show_up: 5,
  reuniao_fechamento: 5,
};

/** Peso do palpite original, em "observações equivalentes" (média bayesiana). */
const PESO_PRIOR = 20;

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;

function ajustar(etapa: Etapa, estimado: number, num: number, den: number, nome: string): AjusteEtapa {
  const real = den > 0 ? num / den : null;
  if (den < MIN_AMOSTRA[etapa] || real == null) {
    return {
      etapa,
      estimado,
      real,
      amostra: den,
      sugerido: estimado,
      confianca: "insuficiente",
      mensagem: `${nome}: ${den} de ${MIN_AMOSTRA[etapa]} registros necessários para ajustar. Mantendo ${pct(estimado)}.`,
    };
  }
  const sugerido = (num + estimado * PESO_PRIOR) / (den + PESO_PRIOR);
  const confianca = den >= MIN_AMOSTRA[etapa] * 6 ? "alta" : den >= MIN_AMOSTRA[etapa] * 2 ? "media" : "baixa";
  const dir = sugerido > estimado ? "acima" : sugerido < estimado ? "abaixo" : "igual";
  return {
    etapa,
    estimado,
    real,
    amostra: den,
    sugerido,
    confianca,
    mensagem:
      dir === "igual"
        ? `${nome}: real ${pct(real)}, igual ao estimado.`
        : `${nome}: real ${pct(real)}, ${dir} dos ${pct(estimado)} estimados. Sugestão: ${pct(sugerido)}.`,
  };
}

export type Sugestao = {
  etapas: AjusteEtapa[];
  atual: GoldenNumbers;
  sugerida: GoldenNumbers;
  /** Quantas ligações por dia a mais (ou a menos) a realidade pede. */
  delta_ligacoes_dia: number;
  /** Só vale recomendar o recálculo quando pelo menos uma etapa tem dado suficiente. */
  recomendar: boolean;
  resumo: string;
};

export function sugerirAjuste(meta: GoalsInput, t: Totais): Sugestao {
  const etapas = [
    ajustar("ligacao_decisor", meta.rateCallToDecision, t.decisions_reached, t.calls_made, "Ligação → decisor"),
    ajustar("decisor_reuniao", meta.rateDecisionToMeeting, t.meetings_scheduled, t.decisions_reached, "Decisor → reunião"),
    ajustar("show_up", meta.rateShowUp, t.meetings_held, t.meetings_scheduled, "Comparecimento"),
    ajustar("reuniao_fechamento", meta.rateMeetingToClose, t.closes, t.meetings_held, "Reunião → fechamento"),
  ];
  const por = Object.fromEntries(etapas.map((e) => [e.etapa, e.sugerido])) as Record<Etapa, number>;
  const sugeridaMeta: GoalsInput = {
    ...meta,
    rateCallToDecision: por.ligacao_decisor,
    rateDecisionToMeeting: por.decisor_reuniao,
    rateShowUp: por.show_up,
    rateMeetingToClose: por.reuniao_fechamento,
  };
  const atual = computeGoldenNumbers(meta);
  const sugerida = computeGoldenNumbers(sugeridaMeta);
  const delta = sugerida.daily.calls - atual.daily.calls;
  const recomendar = etapas.some((e) => e.confianca !== "insuficiente") && delta !== 0;
  return {
    etapas,
    atual,
    sugerida,
    delta_ligacoes_dia: delta,
    recomendar,
    resumo: !etapas.some((e) => e.confianca !== "insuficiente")
      ? "Ainda não há ligações suficientes para ajustar a meta com segurança."
      : delta === 0
        ? "A meta diária continua adequada ao seu funil real."
        : delta > 0
          ? `Seu funil real converte menos que o estimado: faça ${delta} ligações a mais por dia (${sugerida.daily.calls}) para manter a meta.`
          : `Seu funil real converte mais que o estimado: ${Math.abs(delta)} ligações a menos por dia (${sugerida.daily.calls}) já bastam.`,
  };
}

export function metaDeLinha(g: {
  monthly_revenue_target: number;
  avg_ticket: number;
  prospecting_days_per_week: number;
  hours_per_day: number;
  rate_call_to_decision: number;
  rate_decision_to_meeting: number;
  rate_show_up: number;
  rate_meeting_to_close: number;
}): GoalsInput {
  return {
    monthlyRevenueTarget: Number(g.monthly_revenue_target),
    avgTicket: Number(g.avg_ticket),
    prospectingDaysPerWeek: Number(g.prospecting_days_per_week),
    hoursPerDay: Number(g.hours_per_day),
    rateCallToDecision: Number(g.rate_call_to_decision),
    rateDecisionToMeeting: Number(g.rate_decision_to_meeting),
    rateShowUp: Number(g.rate_show_up),
    rateMeetingToClose: Number(g.rate_meeting_to_close),
  };
}
