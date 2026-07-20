export type GoalsInput = {
  monthlyRevenueTarget: number;
  avgTicket: number;
  prospectingDaysPerWeek: number;
  hoursPerDay: number;
  rateCallToDecision: number; // 0..1
  rateDecisionToMeeting: number;
  rateShowUp: number;
  rateMeetingToClose: number;
};

export type GoldenNumbers = {
  workingDaysPerMonth: number;
  monthly: {
    calls: number;
    decisions: number;
    meetingsSched: number;
    meetingsHeld: number;
    closes: number;
    revenue: number;
  };
  daily: {
    calls: number;
    decisions: number;
    meetingsSched: number;
    secondsPerCall: number;
  };
};

function safeRate(r: number) {
  if (!isFinite(r) || r <= 0) return 0.0001;
  return Math.min(r, 1);
}

export function computeGoldenNumbers(g: GoalsInput): GoldenNumbers {
  const workingDaysPerMonth = Math.max(1, Math.round(g.prospectingDaysPerWeek * 4.33));
  const ticket = Math.max(1, g.avgTicket);
  const closesMonth = Math.max(0, Math.ceil((g.monthlyRevenueTarget || 0) / ticket));
  const rClose = safeRate(g.rateMeetingToClose);
  const rShow = safeRate(g.rateShowUp);
  const rMeet = safeRate(g.rateDecisionToMeeting);
  const rDec = safeRate(g.rateCallToDecision);
  const meetingsHeld = Math.ceil(closesMonth / rClose);
  const meetingsSched = Math.ceil(meetingsHeld / rShow);
  const decisions = Math.ceil(meetingsSched / rMeet);
  const calls = Math.ceil(decisions / rDec);

  const callsPerDay = Math.ceil(calls / workingDaysPerMonth);
  const decisionsPerDay = Math.ceil(decisions / workingDaysPerMonth);
  const meetingsSchedPerDay = Math.ceil(meetingsSched / workingDaysPerMonth);
  const secondsPerCall = callsPerDay > 0
    ? Math.max(30, Math.floor((g.hoursPerDay * 3600) / callsPerDay))
    : 0;

  return {
    workingDaysPerMonth,
    monthly: {
      calls,
      decisions,
      meetingsSched,
      meetingsHeld,
      closes: closesMonth,
      revenue: closesMonth * ticket,
    },
    daily: {
      calls: callsPerDay,
      decisions: decisionsPerDay,
      meetingsSched: meetingsSchedPerDay,
      secondsPerCall,
    },
  };
}

export function formatBRL(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n || 0);
}

export function formatSeconds(total: number) {
  const s = Math.max(0, Math.floor(total));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function onlyDigits(s: string | null | undefined) {
  return (s ?? "").replace(/\D+/g, "");
}

export function formatCNPJ(cnpj: string | null | undefined) {
  const d = onlyDigits(cnpj);
  if (d.length !== 14) return cnpj ?? "";
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

export function formatPhoneBR(phone: string | null | undefined) {
  const d = onlyDigits(phone);
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return phone ?? "";
}

export function whatsappLink(phone: string | null | undefined, message?: string) {
  const d = onlyDigits(phone);
  if (!d) return "";
  const num = d.length <= 11 ? `55${d}` : d;
  const msg = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${num}${msg}`;
}