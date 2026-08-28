/**
 * Cadência de prospecção: 5 toques em 14 dias, alternando WhatsApp e ligação.
 *
 * Sem I/O de propósito — a página e o cockpit compartilham estas regras, e assim
 * elas ficam num lugar só.
 *
 * O estado vive em `leads.cadencia_etapa` / `cadencia_proximo_em` /
 * `cadencia_status`, e cada toque é gravado em `public.disparos`. O default da
 * coluna é etapa 0, então lead novo vindo do Apify já nasce pronto para o
 * primeiro toque sem o scraper precisar saber que a cadência existe.
 */

export type Canal = "whatsapp" | "ligacao";

export type PassoCadencia = {
  etapa: number;
  /** Dia da cadência, contado a partir do primeiro toque. */
  dia: number;
  canal: Canal;
  titulo: string;
};

export const CADENCIA: PassoCadencia[] = [
  { etapa: 1, dia: 0, canal: "whatsapp", titulo: "Primeira abordagem" },
  { etapa: 2, dia: 2, canal: "ligacao", titulo: "Tentativa com o decisor" },
  { etapa: 3, dia: 5, canal: "whatsapp", titulo: "Follow-up" },
  { etapa: 4, dia: 9, canal: "ligacao", titulo: "Última tentativa" },
];

/** Depois do passo 4 a cadência se esgota; 14 dias após o início ela encerra. */
export const DIA_ENCERRAMENTO = 14;
export const TOTAL_PASSOS = CADENCIA.length;

export type StatusCadencia = "ativa" | "pausada" | "encerrada" | "respondeu";

export type LeadCadencia = {
  cadencia_etapa: number | null;
  cadencia_proximo_em: string | null;
  cadencia_status: string | null;
};

/** Próximo passo a executar, ou null quando a cadência se esgotou. */
export function proximoPasso(etapaAtual: number | null | undefined): PassoCadencia | null {
  const atual = etapaAtual ?? 0;
  return CADENCIA.find((p) => p.etapa === atual + 1) ?? null;
}

/**
 * Quando o toque seguinte vence, contado a partir de agora.
 * Espaçamento relativo em vez de datas fixas desde o início: se você atrasar um
 * dia, a cadência inteira desliza junto em vez de acumular toques vencidos.
 */
export function venceEm(etapaRecemFeita: number, agora = new Date()): Date | null {
  const proximo = CADENCIA.find((p) => p.etapa === etapaRecemFeita + 1);
  if (!proximo) return null;
  const anterior = CADENCIA.find((p) => p.etapa === etapaRecemFeita);
  const intervalo = proximo.dia - (anterior?.dia ?? 0);
  const d = new Date(agora);
  d.setDate(d.getDate() + intervalo);
  return d;
}

export type SituacaoLead =
  | "novo"
  | "vencido"
  | "hoje"
  | "agendado"
  | "esgotada"
  | "encerrada"
  | "respondeu"
  | "pausada";

/** Como o lead deve ser tratado agora. */
export function situacao(lead: LeadCadencia, agora = new Date()): SituacaoLead {
  const st = lead.cadencia_status ?? "ativa";
  if (st === "encerrada") return "encerrada";
  if (st === "respondeu") return "respondeu";
  if (st === "pausada") return "pausada";

  const etapa = lead.cadencia_etapa ?? 0;
  if (etapa === 0) return "novo";
  if (etapa >= TOTAL_PASSOS) return "esgotada";
  if (!lead.cadencia_proximo_em) return "vencido";

  const prox = new Date(lead.cadencia_proximo_em);
  if (Number.isNaN(prox.getTime())) return "vencido";

  // Recorte pelo dia LOCAL: "vence hoje" tem que bater com o calendário de quem
  // liga, não com UTC.
  const fim = new Date(agora);
  fim.setHours(23, 59, 59, 999);
  const inicio = new Date(agora);
  inicio.setHours(0, 0, 0, 0);

  if (prox < inicio) return "vencido";
  if (prox <= fim) return "hoje";
  return "agendado";
}

/** Situações em que o lead pede ação agora. */
export const SITUACOES_ACIONAVEIS: SituacaoLead[] = ["novo", "vencido", "hoje"];

export const ROTULO_SITUACAO: Record<SituacaoLead, string> = {
  novo: "Nunca tocado",
  vencido: "Atrasado",
  hoje: "Vence hoje",
  agendado: "Agendado",
  esgotada: "Cadência esgotada",
  encerrada: "Encerrado",
  respondeu: "Respondeu",
  pausada: "Pausado",
};

// ---------- telefone ----------

export const soDigitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/**
 * Tira o 55 do país quando ele existe de fato. O guarda de 12 dígitos evita
 * comer o DDD 55 (Rio Grande do Sul) de um celular escrito sem país.
 */
export function semPais(tel: string | null | undefined): string {
  const d = soDigitos(tel);
  return d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
}

/** Celular brasileiro: DDD + 9 dígitos começando em 9. */
export function ehCelular(tel: string | null | undefined): boolean {
  const d = semPais(tel);
  return d.length === 11 && d[2] === "9";
}

export type LeadTelefones = {
  whatsapp?: string | null;
  telefone_1?: string | null;
  telefone_2?: string | null;
};

/**
 * Melhor número para WhatsApp. Só devolve celular: 70% da base é telefone fixo,
 * e mandar para fixo abre uma conversa que nunca será lida — pior que não ter
 * botão, porque parece que funcionou.
 */
export function numeroWhatsapp(lead: LeadTelefones): string | null {
  for (const t of [lead.whatsapp, lead.telefone_1, lead.telefone_2]) {
    if (ehCelular(t)) return soDigitos(t);
  }
  return null;
}

/** Mensagem de abertura, com o nome do decisor quando ele é conhecido. */
export function mensagemAbertura(empresa: string | null, decisor: string | null): string {
  const primeiroNome = decisor?.trim().split(/\s+/)[0];
  const tratamento = primeiroNome
    ? `Olá, ${primeiroNome[0].toUpperCase()}${primeiroNome.slice(1).toLowerCase()}!`
    : "Olá, tudo bem?";
  return `${tratamento} Falo com ${empresa ?? "a autoescola"}?`;
}
