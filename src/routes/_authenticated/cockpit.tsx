import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { enrichLeadOnDemand } from "@/lib/enrichment.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Phone, PhoneOff, CalendarClock, MessageCircle, SkipForward, VoicemailIcon,
  Timer, Building2, MapPin, ArrowRight, Users2, Star, BarChart3, MapPinned, Sparkles,
  History,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  computeGoldenNumbers, formatBRL, formatPhoneBR, formatSeconds,
  whatsappLink, type GoalsInput,
} from "@/lib/goldenMath";

export const Route = createFileRoute("/_authenticated/cockpit")({
  head: () => ({
    meta: [
      { title: "Cockpit · Meta Prospect" },
      { name: "description", content: "Modo Foco: um lead por vez, timer inteligente e hotkeys 1-5." },
    ],
  }),
  component: Cockpit,
});

type Outcome =
  | "no_answer" | "gatekeeper" | "not_interested" | "meeting_scheduled" | "callback";

const OUTCOMES: { key: Outcome; label: string; hotkey: string; icon: React.ElementType; status: string; }[] = [
  { key: "no_answer",        label: "Não atendeu",      hotkey: "1", icon: VoicemailIcon, status: "no_answer" },
  { key: "gatekeeper",       label: "Ponte / Secretária", hotkey: "2", icon: PhoneOff,   status: "gatekeeper" },
  { key: "not_interested",   label: "Sem interesse",    hotkey: "3", icon: PhoneOff,     status: "not_interested" },
  { key: "callback",         label: "Retornar depois",  hotkey: "4", icon: CalendarClock, status: "callback" },
  { key: "meeting_scheduled",label: "Reunião agendada!",hotkey: "5", icon: CalendarClock, status: "meeting_scheduled" },
];

function todayISO() { return new Date().toISOString().slice(0, 10); }

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAY_PT: Record<string, string> = {
  monday: "Segunda", tuesday: "Terça", wednesday: "Quarta", thursday: "Quinta",
  friday: "Sexta", saturday: "Sábado", sunday: "Domingo",
  "segunda-feira": "Segunda", "terça-feira": "Terça", "quarta-feira": "Quarta",
  "quinta-feira": "Quinta", "sexta-feira": "Sexta", sábado: "Sábado", domingo: "Domingo",
};

const WEEK_ORDER = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

function normalizeHours(raw: unknown): { day: string; hours: string }[] {
  if (!raw) return [];
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "object"
      ? Object.entries(raw as Record<string, unknown>).map(([day, hours]) => ({ day, hours }))
      : [];
  const out = list
    .map((it: any) => {
      const d = String(it?.day ?? "").trim();
      const h = String(it?.hours ?? it?.value ?? "").trim();
      if (!d) return null;
      return { day: DAY_PT[d.toLowerCase()] ?? d, hours: h || "—" };
    })
    .filter(Boolean) as { day: string; hours: string }[];
  return out.sort((a, b) => WEEK_ORDER.indexOf(a.day) - WEEK_ORDER.indexOf(b.day));
}

function todayPt(): string {
  return WEEK_ORDER[(new Date().getDay() + 6) % 7];
}

function timeAgoBR(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function Cockpit() {
  const qc = useQueryClient();
  const [city, setCity] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("cockpit-city") ?? "";
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("cockpit-city", city);
  }, [city]);

  // Cidades disponíveis (com leads ainda ativos)
  const { data: cities = [] } = useQuery({
    queryKey: ["cockpit-cities"],
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("cidade")
        .in("status", ["new", "no_answer", "gatekeeper", "callback"])
        .not("cidade", "is", null);
      const map = new Map<string, number>();
      (data ?? []).forEach((r: any) => {
        const c = (r.cidade ?? "").trim();
        if (c) map.set(c, (map.get(c) ?? 0) + 1);
      });
      return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
    },
  });

  // Se cidade escolhida não existe mais, escolhe a com mais leads
  useEffect(() => {
    if (cities.length === 0) return;
    if (!city || !cities.some((c) => c.name === city)) {
      setCity(cities[0].name);
    }
  }, [cities, city]);

  const { data: goal } = useQuery({
    queryKey: ["goals-active"],
    queryFn: async () => {
      const { data } = await supabase.from("goals_math").select("*")
        .eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const { data: metrics } = useQuery({
    queryKey: ["daily-metric", todayISO()],
    queryFn: async () => {
      const { data } = await supabase.from("daily_metrics").select("*").eq("day", todayISO()).maybeSingle();
      return data;
    },
  });

  const { data: leadQueue, refetch: refetchQueue } = useQuery({
    queryKey: ["cockpit-queue", city],
    enabled: !!city,
    queryFn: async () => {
      // Busca um lote e ordena por prioridade em memória:
      //  1) follow-up marcado (mais próximo primeiro)
      //  2) callback vencido (retorno_agendado_em <= agora)
      //  3) nunca ligado (last_call_at == null)
      //  4) resto por last_call_at asc
      const { data } = await supabase.from("leads").select("*")
        .eq("cidade", city)
        .in("status", ["new", "no_answer", "gatekeeper", "callback"])
        .order("last_call_at", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true })
        .limit(30);
      const now = Date.now();
      const rows = (data ?? []).slice();
      const priority = (l: any) => {
        if (l.followup_at) return 0;
        if (l.retorno_agendado_em && new Date(l.retorno_agendado_em).getTime() <= now) return 1;
        if (!l.last_call_at) return 2;
        return 3;
      };
      const sortKey = (l: any) => {
        if (l.followup_at) return new Date(l.followup_at).getTime();
        if (l.retorno_agendado_em) return new Date(l.retorno_agendado_em).getTime();
        if (l.last_call_at) return new Date(l.last_call_at).getTime();
        return 0;
      };
      rows.sort((a, b) => {
        const pa = priority(a), pb = priority(b);
        if (pa !== pb) return pa - pb;
        return sortKey(a) - sortKey(b);
      });
      return rows.slice(0, 1);
    },
  });

  const lead = leadQueue?.[0] ?? null;

  const { data: leadHistory } = useQuery({
    queryKey: ["cockpit-lead-history", lead?.id ?? null],
    enabled: !!lead?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("call_logs")
        .select("id, outcome, notes, duration_seconds, nome_ponte, scheduled_return_at, created_at")
        .eq("lead_id", lead!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: cityStats } = useQuery({
    queryKey: ["city-reviews", lead?.cidade ?? null],
    enabled: !!lead?.cidade,
    queryFn: async () => {
      const { data } = await supabase.from("leads")
        .select("id, nome_fantasia, google_reviews, google_rating")
        .eq("cidade", lead!.cidade as string)
        .not("google_reviews", "is", null);
      const arr = (data ?? []).filter((r: any) => typeof r.google_reviews === "number");
      if (!arr.length) return null;
      const total = arr.reduce((s: number, r: any) => s + (r.google_reviews ?? 0), 0);
      const avg = total / arr.length;
      const max = arr.reduce((m: any, r: any) => (r.google_reviews > (m?.google_reviews ?? -1) ? r : m), null as any);
      return { count: arr.length, avg, max };
    },
  });

  const nums = useMemo(() => {
    if (!goal) return null;
    const g: GoalsInput = {
      monthlyRevenueTarget: Number(goal.monthly_revenue_target),
      avgTicket: Number(goal.avg_ticket),
      prospectingDaysPerWeek: Number(goal.prospecting_days_per_week),
      hoursPerDay: Number(goal.hours_per_day),
      rateCallToDecision: Number(goal.rate_call_to_decision),
      rateDecisionToMeeting: Number(goal.rate_decision_to_meeting),
      rateShowUp: Number(goal.rate_show_up),
      rateMeetingToClose: Number(goal.rate_meeting_to_close),
    };
    return computeGoldenNumbers(g);
  }, [goal]);

  // per-call timer
  const [remaining, setRemaining] = useState<number>(0);
  const startedAt = useRef<number>(Date.now());
  useEffect(() => {
    if (!nums) return;
    setRemaining(nums.daily.secondsPerCall);
    startedAt.current = Date.now();
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setRemaining(Math.max(0, nums.daily.secondsPerCall - elapsed));
    }, 500);
    return () => clearInterval(id);
  }, [lead?.id, nums]);

  const [nomePonte, setNomePonte] = useState("");
  const [returnAt, setReturnAt] = useState("");
  const [nomeDecisor, setNomeDecisor] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [followupAt, setFollowupAt] = useState("");
  const [followupNotes, setFollowupNotes] = useState("");

  // JIT: enriquece o lead atual se faltar proprietário/sócios
  const enrichNow = useServerFn(enrichLeadOnDemand);
  const [jitLoading, setJitLoading] = useState(false);
  const jitTried = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!lead?.id) return;
    const socios = Array.isArray(lead.socios) ? (lead.socios as any[]) : [];
    const hasOwner = !!lead.proprietario || socios.length > 0;
    const skip = lead.enrichment_status === "not_found" || lead.enrichment_status === "inactive";
    if (hasOwner || skip) return;
    if (jitTried.current.has(lead.id)) return;
    jitTried.current.add(lead.id);
    setJitLoading(true);
    const targetId = lead.id;
    enrichNow({ data: { leadId: lead.id } })
      .then(async () => {
        // Atualiza somente a linha atual no cache — nunca reordena a fila
        // nem substitui o lead em foco enquanto o SDR digita.
        const { data: fresh } = await supabase
          .from("leads")
          .select("*")
          .eq("id", targetId)
          .maybeSingle();
        if (!fresh) return;
        qc.setQueryData<any[]>(["cockpit-queue", city], (old) =>
          Array.isArray(old) ? old.map((l) => (l.id === targetId ? { ...l, ...fresh } : l)) : old,
        );
      })
      .catch(() => {})
      .finally(() => setJitLoading(false));
  }, [lead?.id, lead?.proprietario, lead?.socios, lead?.enrichment_status, enrichNow, qc, city]);

  // Ao trocar de lead: pré-preenche o que já foi salvo antes. Observações
  // e "agendar retorno" ficam em branco (cada ligação é uma nota nova).
  useEffect(() => {
    setNomePonte((lead?.nome_ponte as string | null) ?? "");
    setNomeDecisor((lead?.proprietario as string | null) ?? "");
    setFollowupAt(toDatetimeLocal(lead?.followup_at as string | null | undefined));
    setFollowupNotes((lead?.followup_notes as string | null) ?? "");
    setReturnAt("");
    setCallNotes("");
  }, [lead?.id, lead?.nome_ponte, lead?.proprietario, lead?.followup_at, lead?.followup_notes]);

  async function logOutcome(o: Outcome) {
    if (!lead) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const durationSeconds = Math.max(1, Math.floor((Date.now() - startedAt.current) / 1000));

    const meta = OUTCOMES.find((x) => x.key === o)!;
    const stageMap: Record<Outcome, string> = {
      no_answer: "in_contact",
      gatekeeper: "in_contact",
      callback: "in_contact",
      not_interested: "dismissed",
      meeting_scheduled: "scheduled",
    };
    const leadUpdate: Record<string, any> = {
      status: meta.status,
      pipeline_stage: stageMap[o],
      last_call_at: new Date().toISOString(),
    };
    if (nomePonte) leadUpdate.nome_ponte = nomePonte;
    if ((o === "callback" || o === "meeting_scheduled") && returnAt) {
      leadUpdate.retorno_agendado_em = new Date(returnAt).toISOString();
      if (o === "meeting_scheduled") leadUpdate.meeting_at = new Date(returnAt).toISOString();
    }
    if (nomeDecisor) leadUpdate.proprietario = nomeDecisor;
    if (followupAt) {
      leadUpdate.followup_at = new Date(followupAt).toISOString();
      if (followupNotes) leadUpdate.followup_notes = followupNotes;
    }
    const { error: uErr } = await supabase.from("leads").update(leadUpdate as any).eq("id", lead.id);
    if (uErr) return toast.error(uErr.message);

    const { error: cErr } = await supabase.from("call_logs").insert({
      user_id: u.user.id, lead_id: lead.id, outcome: o,
      duration_seconds: durationSeconds,
      nome_ponte: nomePonte || null,
      scheduled_return_at: returnAt ? new Date(returnAt).toISOString() : null,
      notes: [nomeDecisor ? `Decisor: ${nomeDecisor}` : null, callNotes || null].filter(Boolean).join(" · ") || null,
    });
    if (cErr) return toast.error(cErr.message);

    // upsert daily metric
    const day = todayISO();
    const cur = metrics ?? { calls_made: 0, decisions_reached: 0, meetings_scheduled: 0, meetings_held: 0, closes: 0, revenue: 0 };
    const delta = {
      calls_made: (cur.calls_made ?? 0) + 1,
      decisions_reached: (cur.decisions_reached ?? 0) + (o === "gatekeeper" || o === "meeting_scheduled" || o === "not_interested" ? 1 : 0),
      meetings_scheduled: (cur.meetings_scheduled ?? 0) + (o === "meeting_scheduled" ? 1 : 0),
    };
    await supabase.from("daily_metrics").upsert(
      { user_id: u.user.id, day, ...cur, ...delta },
      { onConflict: "user_id,day" }
    );

    setNomePonte(""); setReturnAt(""); setNomeDecisor(""); setCallNotes("");
    setFollowupAt(""); setFollowupNotes("");
    toast.success(`Registrado: ${meta.label}`);
    qc.invalidateQueries({ queryKey: ["daily-metric", day] });
    qc.invalidateQueries({ queryKey: ["crm-leads"] });
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["cockpit-cities"] });
    qc.invalidateQueries({ queryKey: ["cockpit-lead-history", lead.id] });
    refetchQueue();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const o = OUTCOMES.find((x) => x.hotkey === e.key);
      if (o) { e.preventDefault(); logOutcome(o.key); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id, nomePonte, returnAt, nomeDecisor, callNotes, followupAt, followupNotes, metrics]);

  if (!goal) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-bold">Configure seus Números de Ouro</h1>
        <p className="mt-2 text-muted-foreground">Sem meta, sem ritmo. Comece configurando.</p>
        <Button asChild className="mt-6 rounded-2xl"><Link to="/goals">Configurar agora <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
      </div>
    );
  }

  const done = metrics?.calls_made ?? 0;
  const target = nums?.daily.calls ?? 1;
  const pct = Math.min(100, Math.round((done / target) * 100));
  const timerPct = nums ? Math.round(((nums.daily.secondsPerCall - remaining) / nums.daily.secondsPerCall) * 100) : 0;
  const overtime = remaining <= 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Cockpit</div>
          <h1 className="mt-1 text-4xl tracking-tight md:text-5xl">Modo Foco</h1>
          <p className="mt-1 text-muted-foreground">{done} / {target} ligações hoje · meta: {formatBRL(nums?.monthly.revenue ?? 0)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-2 py-1">
            <MapPinned className="ml-1 h-3.5 w-3.5 text-primary" />
            <Select value={city || undefined} onValueChange={(v) => { setCity(v); toast.success(`Cidade: ${v}`); }}>
              <SelectTrigger className="h-8 min-w-44 border-0 bg-transparent shadow-none focus:ring-0">
                <SelectValue placeholder="Escolher cidade" />
              </SelectTrigger>
              <SelectContent>
                {cities.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">Sem cidades com leads ativos</div>}
                {cities.map((c) => (
                  <SelectItem key={c.name} value={c.name}>{c.name} · {c.count}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm">
            <Timer className="mr-1 h-3.5 w-3.5" /> Tempo por call: {formatSeconds(nums?.daily.secondsPerCall ?? 0)}
          </Badge>
        </div>
      </div>

      <Progress value={pct} className="mb-6 h-2 rounded-full" />

      {!lead ? (
        <Card className="rounded-3xl border-dashed border-border p-10 text-center">
          <p className="text-lg font-medium">
            {city ? `Fila de ${city} concluída 🎉` : "Nenhuma cidade selecionada"}
          </p>
          <p className="mt-1 text-muted-foreground">
            {cities.length > 1
              ? "Escolha outra cidade acima para continuar prospectando."
              : "Importe leads para continuar prospectando."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {cities.filter((c) => c.name !== city).slice(0, 4).map((c) => (
              <Button key={c.name} variant="outline" className="rounded-2xl" onClick={() => { setCity(c.name); toast.success(`Cidade: ${c.name}`); }}>
                <MapPinned className="mr-2 h-4 w-4" />{c.name} <span className="ml-1 text-xs text-muted-foreground">· {c.count}</span>
              </Button>
            ))}
            <Button asChild className="rounded-2xl"><Link to="/leads">Ir para Leads</Link></Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{lead.razao_social ?? "Sem razão social"}</p>
                  <h2 className="mt-1 text-3xl tracking-tight">{lead.nome_fantasia ?? lead.razao_social ?? "Lead"}</h2>
                  {lead.followup_at && (
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                      🔁 Follow-up{lead.proprietario ? ` com ${lead.proprietario}` : ""} · {new Date(lead.followup_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {lead.followup_notes ? <span className="ml-1 font-normal opacity-80">· {lead.followup_notes}</span> : null}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    {lead.bairro && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{lead.bairro}{lead.cidade ? ` · ${lead.cidade}` : ""}</span>}
                    {lead.capital_social ? <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> Cap. {formatBRL(Number(lead.capital_social))}</span> : null}
                  </div>
                </div>
                <div className={`grid place-items-center rounded-2xl px-5 py-3 text-right ${overtime ? "bg-destructive/10 text-destructive" : "bg-foreground text-background"}`}>
                  <span className="text-[11px] uppercase tracking-wide">{overtime ? "Passou" : "Restante"}</span>
                  <span className="font-display text-4xl tabular-nums">{formatSeconds(overtime ? -remaining : remaining)}</span>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {lead.telefone_1 && (
                  <a href={`tel:${lead.telefone_1}`} className="flex items-center gap-3 rounded-2xl border border-border bg-secondary px-4 py-3 hover:bg-accent">
                    <Phone className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Telefone 1</p>
                      <p className="font-semibold">{formatPhoneBR(lead.telefone_1)}</p>
                    </div>
                  </a>
                )}
                {lead.telefone_2 && (
                  <a href={`tel:${lead.telefone_2}`} className="flex items-center gap-3 rounded-2xl border border-border bg-secondary px-4 py-3 hover:bg-accent">
                    <Phone className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Telefone 2</p>
                      <p className="font-semibold">{formatPhoneBR(lead.telefone_2)}</p>
                    </div>
                  </a>
                )}
                {(lead.whatsapp || lead.telefone_1) && (
                  <a target="_blank" rel="noopener noreferrer" href={whatsappLink(lead.whatsapp ?? lead.telefone_1)} className="flex items-center gap-3 rounded-2xl border border-border bg-secondary px-4 py-3 hover:bg-accent">
                    <MessageCircle className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">WhatsApp Web</p>
                      <p className="font-semibold">Abrir conversa</p>
                    </div>
                  </a>
                )}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border bg-background p-4">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    <Users2 className="h-3.5 w-3.5" /> Proprietário & Sócios
                  </div>
                  {(() => {
                    const nomes = Array.isArray(lead.socios)
                      ? (lead.socios as any[]).map((s: any) => (typeof s === "string" ? s : s?.nome || s?.nome_socio)).filter(Boolean)
                      : [];
                    const prop = lead.proprietario as string | null;
                    if (!prop && nomes.length === 0) {
                      if (jitLoading) {
                        return (
                          <p className="mt-2 inline-flex items-center gap-2 text-sm italic text-primary">
                            <Sparkles className="h-3.5 w-3.5 animate-pulse" /> Buscando proprietário na Receita…
                          </p>
                        );
                      }
                      if (lead.enrichment_status === "inactive") {
                        return <p className="mt-2 text-sm italic text-rose-600">CNPJ inativo/baixado — pule este lead.</p>;
                      }
                      return <p className="mt-2 text-sm italic text-muted-foreground">Não temos o nome do proprietário/sócios deste lead.</p>;
                    }
                    return (
                      <div className="mt-2 space-y-1">
                        {prop && <p className="text-sm font-semibold">{prop} <span className="text-xs font-normal text-muted-foreground">· decisor</span></p>}
                        {nomes.filter((n: string) => n !== prop).map((n: string, i: number) => (
                          <p key={i} className="text-sm text-foreground/80">{n}</p>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="rounded-2xl border border-border bg-background p-4">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    <Star className="h-3.5 w-3.5" /> Google Reviews
                  </div>
                  {lead.google_reviews == null ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-sm italic text-muted-foreground">Sem dados de avaliações do Google para este lead.</p>
                      {cityStats && (
                        <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> {cityStats.count} autoescolas de {lead.cidade} com reviews</div>
                          <p className="mt-1">Média: <b className="text-foreground">{cityStats.avg.toFixed(0)}</b> · Líder: <b className="text-foreground">{cityStats.max?.nome_fantasia ?? "—"}</b> ({cityStats.max?.google_reviews})</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold tabular-nums">{lead.google_reviews}</span>
                        <span className="text-xs text-muted-foreground">avaliações</span>
                        {lead.google_rating != null && (
                          <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-amber-600">
                            <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />{Number(lead.google_rating).toFixed(1)}
                          </span>
                        )}
                      </div>
                      {cityStats && cityStats.count > 1 ? (
                        <div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> vs. {cityStats.count} autoescolas em {lead.cidade}</div>
                          {(() => {
                            const diff = (lead.google_reviews ?? 0) - cityStats.avg;
                            const pct = cityStats.avg > 0 ? Math.round((diff / cityStats.avg) * 100) : 0;
                            const above = diff >= 0;
                            return (
                              <div className="mt-1 space-y-0.5">
                                <p>Média da cidade: <b className="text-foreground">{cityStats.avg.toFixed(0)}</b></p>
                                <p>Líder: <b className="text-foreground">{cityStats.max?.nome_fantasia ?? "—"}</b> ({cityStats.max?.google_reviews})</p>
                                <p className={above ? "text-emerald-600" : "text-rose-600"}>
                                  {above ? "▲" : "▼"} {Math.abs(pct)}% {above ? "acima" : "abaixo"} da média
                                </p>
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        <p className="mt-3 border-t border-border pt-2 text-xs italic text-muted-foreground">
                          Sem outras autoescolas em {lead.cidade ?? "—"} com reviews para comparar. Rode "Buscar no Google Maps" para trazer mais concorrentes.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Nome da Ponte</Label>
                  <Input placeholder="Secretária / atendente" className="rounded-xl" value={nomePonte} onChange={(e) => setNomePonte(e.target.value)} />
                </div>
                <div>
                  <Label>Agendar retorno</Label>
                  <Input type="datetime-local" className="rounded-xl" value={returnAt} onChange={(e) => setReturnAt(e.target.value)} />
                </div>
              </div>

              <div className="mt-3 grid gap-3">
                <div>
                  <Label>Nome do Decisor (se conseguiu falar)</Label>
                  <Input placeholder="Ex: João Silva" className="rounded-xl" value={nomeDecisor} onChange={(e) => setNomeDecisor(e.target.value)} />
                  <p className="mt-1 text-[11px] text-muted-foreground">Salva como proprietário do lead.</p>
                </div>
                {nomeDecisor && (
                  <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
                    <Label className="text-primary">Follow-up combinado com {nomeDecisor}</Label>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Input type="datetime-local" className="rounded-xl" value={followupAt} onChange={(e) => setFollowupAt(e.target.value)} />
                      <Input placeholder="Motivo (ex: enviar proposta)" className="rounded-xl" value={followupNotes} onChange={(e) => setFollowupNotes(e.target.value)} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">Aparece no CRM SDR do lead.</p>
                  </div>
                )}
                <div>
                  <Label>Observações da ligação</Label>
                  <Textarea placeholder="Contexto, objeção, próximos passos…" className="min-h-20 rounded-xl" value={callNotes} onChange={(e) => setCallNotes(e.target.value)} />
                </div>
              </div>

              <div className="mt-4 h-1 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, timerPct)}%` }} />
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
          <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <History className="h-3.5 w-3.5" /> Histórico deste lead
              </div>
              {(() => {
                const logs = leadHistory ?? [];
                if (logs.length === 0) {
                  return <p className="mt-2 text-sm italic text-muted-foreground">Primeiro contato com este lead.</p>;
                }
                const last = logs[0] as any;
                const meta = OUTCOMES.find((x) => x.key === last.outcome);
                const Icon = meta?.icon ?? Phone;
                return (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
                          <Icon className="h-4 w-4" /> {meta?.label ?? last.outcome}
                        </span>
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{timeAgoBR(last.created_at)}</span>
                      </div>
                      {last.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/85">{last.notes}</p>}
                      {last.scheduled_return_at && (
                        <p className="mt-1 text-xs text-muted-foreground">Retorno combinado: {new Date(last.scheduled_return_at).toLocaleString("pt-BR")}</p>
                      )}
                    </div>
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{logs.length} ligaç{logs.length === 1 ? "ão" : "ões"} registrada{logs.length === 1 ? "" : "s"}</p>
                    {logs.length > 1 && (
                      <ul className="space-y-1">
                        {logs.slice(1).map((l: any) => {
                          const m = OUTCOMES.find((x) => x.key === l.outcome);
                          return (
                            <li key={l.id} className="flex items-start justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs">
                              <div className="min-w-0">
                                <div className="font-medium text-foreground">{m?.label ?? l.outcome}</div>
                                {l.notes && <div className="truncate text-muted-foreground">{l.notes}</div>}
                              </div>
                              <span className="shrink-0 text-muted-foreground">{timeAgoBR(l.created_at)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
            <CardContent className="p-6">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Desfecho da ligação</p>
              <p className="mt-1 text-sm text-muted-foreground">Use as teclas <b>1–5</b> para bater ritmo.</p>
              <div className="mt-4 grid gap-2">
                {OUTCOMES.map((o) => (
                  <Button
                    key={o.key}
                    onClick={() => logOutcome(o.key)}
                    className={`h-12 justify-between rounded-2xl text-left ${o.key === "meeting_scheduled" ? "bg-primary text-primary-foreground shadow-[var(--shadow-elegant)]" : "bg-white/70 text-foreground hover:bg-white"}`}
                  >
                    <span className="flex items-center gap-3">
                      <o.icon className="h-4 w-4" />
                      {o.label}
                    </span>
                    <kbd className="rounded-lg border border-[color:var(--border-subtle)] bg-white px-2 py-0.5 font-mono text-xs">{o.hotkey}</kbd>
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  className="mt-2 rounded-2xl text-muted-foreground"
                  onClick={async () => {
                    if (!lead) return;
                    await supabase.from("leads").update({ last_call_at: new Date().toISOString() }).eq("id", lead.id);
                    refetchQueue();
                  }}
                >
                  <SkipForward className="mr-2 h-4 w-4" /> Pular por agora
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
            <CardContent className="p-6">
              <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Horário de funcionamento
              </p>
              {(() => {
                const hours = normalizeHours((lead as any)?.opening_hours);
                if (!hours.length) {
                  return (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Sem horário informado no Google Maps para este lead.
                    </p>
                  );
                }
                const today = todayPt();
                return (
                  <div className="mt-3 space-y-1">
                    {hours.map((h) => {
                      const isToday = h.day === today;
                      return (
                        <div
                          key={h.day}
                          className={`flex items-center justify-between rounded-xl px-3 py-1.5 text-sm ${
                            isToday ? "bg-primary/10 font-semibold text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          <span>{h.day}{isToday ? " · hoje" : ""}</span>
                          <span className="tabular-nums">{h.hours}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
          </div>
        </div>
      )}
    </div>
  );
}