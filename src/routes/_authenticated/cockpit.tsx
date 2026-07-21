import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Phone, PhoneOff, CalendarClock, MessageCircle, SkipForward, VoicemailIcon,
  Timer, Building2, MapPin, ArrowRight, Users2, Star, BarChart3,
} from "lucide-react";
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

function Cockpit() {
  const qc = useQueryClient();

  const { data: goal } = useQuery({
    queryKey: ["goals-active"],
    queryFn: async () => {
      const { data } = await supabase.from("goals_math").select("*")
        .eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  const { data: metrics } = useQuery({
    queryKey: ["daily-metric", todayISO()],
    queryFn: async () => {
      const { data } = await supabase.from("daily_metrics").select("*").eq("day", todayISO()).maybeSingle();
      return data;
    },
  });

  const { data: leadQueue, refetch: refetchQueue } = useQuery({
    queryKey: ["cockpit-queue"],
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("*")
        .in("status", ["new", "no_answer", "gatekeeper", "callback"])
        .order("last_call_at", { ascending: true, nullsFirst: true })
        .limit(1);
      return data ?? [];
    },
  });

  const lead = leadQueue?.[0] ?? null;

  const { data: cityStats } = useQuery({
    queryKey: ["city-reviews", lead?.cidade ?? null],
    enabled: !!lead?.cidade,
    queryFn: async () => {
      const { data } = await supabase.from("leads")
        .select("id, nome_fantasia, google_reviews, google_rating")
        .eq("cidade", lead!.cidade)
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

  async function logOutcome(o: Outcome) {
    if (!lead) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const durationSeconds = Math.max(1, Math.floor((Date.now() - startedAt.current) / 1000));

    const meta = OUTCOMES.find((x) => x.key === o)!;
    const { error: uErr } = await supabase.from("leads").update({
      status: meta.status,
      last_call_at: new Date().toISOString(),
      nome_ponte: o === "gatekeeper" && nomePonte ? nomePonte : undefined,
      retorno_agendado_em: (o === "callback" || o === "meeting_scheduled") && returnAt
        ? new Date(returnAt).toISOString() : undefined,
    }).eq("id", lead.id);
    if (uErr) return toast.error(uErr.message);

    const { error: cErr } = await supabase.from("call_logs").insert({
      user_id: u.user.id, lead_id: lead.id, outcome: o,
      duration_seconds: durationSeconds,
      nome_ponte: nomePonte || null,
      scheduled_return_at: returnAt ? new Date(returnAt).toISOString() : null,
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

    setNomePonte(""); setReturnAt("");
    toast.success(`Registrado: ${meta.label}`);
    qc.invalidateQueries({ queryKey: ["daily-metric", day] });
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
  }, [lead?.id, nomePonte, returnAt, metrics]);

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
          <h1 className="text-3xl font-bold tracking-tight">Modo Foco</h1>
          <p className="mt-1 text-muted-foreground">{done} / {target} ligações hoje · meta: {formatBRL(nums?.monthly.revenue ?? 0)}</p>
        </div>
        <Badge variant="secondary" className="rounded-full px-3 py-1 text-sm">
          <Timer className="mr-1 h-3.5 w-3.5" /> Tempo por call: {formatSeconds(nums?.daily.secondsPerCall ?? 0)}
        </Badge>
      </div>

      <Progress value={pct} className="mb-6 h-2 rounded-full" />

      {!lead ? (
        <Card className="rounded-3xl border-dashed border-border p-10 text-center">
          <p className="text-lg font-medium">Fila vazia 🎉</p>
          <p className="mt-1 text-muted-foreground">Importe leads para continuar prospectando.</p>
          <Button asChild className="mt-6 rounded-2xl"><Link to="/leads">Ir para Leads</Link></Button>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card className="rounded-3xl border-border shadow-[var(--shadow-soft)]">
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{lead.razao_social ?? "Sem razão social"}</p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight">{lead.nome_fantasia ?? lead.razao_social ?? "Lead"}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    {lead.bairro && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{lead.bairro}{lead.cidade ? ` · ${lead.cidade}` : ""}</span>}
                    {lead.capital_social ? <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> Cap. {formatBRL(Number(lead.capital_social))}</span> : null}
                  </div>
                </div>
                <div className={`grid place-items-center rounded-2xl px-4 py-3 text-right ${overtime ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground"}`}>
                  <span className="text-[11px] uppercase tracking-wide">{overtime ? "Passou" : "Restante"}</span>
                  <span className="text-3xl font-bold tabular-nums">{formatSeconds(overtime ? -remaining : remaining)}</span>
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
                    <p className="mt-2 text-sm italic text-muted-foreground">Sem dados de avaliações do Google.</p>
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
                      {cityStats && (
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

              <div className="mt-4 h-1 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, timerPct)}%` }} />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-border shadow-[var(--shadow-soft)]">
            <CardContent className="p-6">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Desfecho da ligação</p>
              <p className="mt-1 text-sm text-muted-foreground">Use as teclas <b>1–5</b> para bater ritmo.</p>
              <div className="mt-4 grid gap-2">
                {OUTCOMES.map((o) => (
                  <Button
                    key={o.key}
                    onClick={() => logOutcome(o.key)}
                    className={`h-12 justify-between rounded-2xl text-left ${o.key === "meeting_scheduled" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-accent"}`}
                  >
                    <span className="flex items-center gap-3">
                      <o.icon className="h-4 w-4" />
                      {o.label}
                    </span>
                    <kbd className="rounded-lg border border-border bg-background/70 px-2 py-0.5 text-xs">{o.hotkey}</kbd>
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
        </div>
      )}
    </div>
  );
}