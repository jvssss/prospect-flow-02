import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { computeGoldenNumbers, type GoalsInput } from "@/lib/goldenMath";
import { RadialProgress } from "@/components/radial-progress";
import { Flame, Rocket, AlertTriangle, Trophy, CalendarCheck, Sparkles, Target, Minus } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export const Route = createFileRoute("/_authenticated/diario")({
  head: () => ({
    meta: [
      { title: "Diário de Bordo · Meta Prospect" },
      { name: "description", content: "Compare conversão real vs. estimada e ajuste sua meta diária." },
    ],
  }),
  component: DiarioPage,
});

const todayKey = () => new Date().toISOString().slice(0, 10);

function DiarioPage() {
  const { data: goal } = useQuery({
    queryKey: ["goals-active"],
    queryFn: async () => {
      const { data } = await supabase.from("goals_math").select("*")
        .eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const { data: metrics = [] } = useQuery({
    queryKey: ["daily-metrics-30"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase.from("daily_metrics").select("*")
        .gte("day", since).order("day", { ascending: false });
      return data ?? [];
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

  const byDay = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of metrics) map.set(String(m.day), m);
    return map;
  }, [metrics]);

  const today = byDay.get(todayKey()) ?? { calls_made: 0, decisions_reached: 0, meetings_scheduled: 0, closes: 0 };
  const target = nums?.daily.calls ?? 0;
  const targetDec = nums?.daily.decisions ?? 0;
  const targetMeet = nums?.daily.meetingsSched ?? 0;
  const remaining = Math.max(0, target - today.calls_made);
  const pct = target ? Math.min(100, Math.round((today.calls_made / target) * 100)) : 0;
  const done = pct >= 100;

  const streak = useMemo(() => {
    if (!target) return 0;
    let s = 0;
    const d = new Date();
    for (let i = 0; i < 60; i++) {
      const key = d.toISOString().slice(0, 10);
      const m = byDay.get(key);
      if (m && m.calls_made >= target) s++;
      else if (i > 0) break;
      d.setDate(d.getDate() - 1);
    }
    return s;
  }, [byDay, target]);

  // last 30 days ordered oldest → newest, filled with zeros
  const chain = useMemo(() => {
    const out: { day: string; calls: number; pct: number }[] = [];
    const d = new Date();
    d.setDate(d.getDate() - 29);
    for (let i = 0; i < 30; i++) {
      const key = d.toISOString().slice(0, 10);
      const m = byDay.get(key);
      const calls = m?.calls_made ?? 0;
      out.push({ day: key, calls, pct: target ? Math.min(1, calls / target) : 0 });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [byDay, target]);

  const last14 = chain.slice(-14).map(c => ({
    d: new Date(c.day).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    calls: c.calls,
  }));

  const totals30 = useMemo(() => metrics.reduce((a, m) => ({
    calls: a.calls + m.calls_made,
    decisions: a.decisions + m.decisions_reached,
    meetings: a.meetings + m.meetings_scheduled,
    closes: a.closes + m.closes,
  }), { calls: 0, decisions: 0, meetings: 0, closes: 0 }), [metrics]);

  const realCallToDec = totals30.calls ? totals30.decisions / totals30.calls : 0;
  const realDecToMeet = totals30.decisions ? totals30.meetings / totals30.decisions : 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header + streak */}
      <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 animate-fade-in sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Feedback loop</div>
          <h1 className="mt-1 truncate text-4xl tracking-tight md:text-5xl">Diário de Bordo</h1>
          <p className="mt-1 text-muted-foreground">Seu placar diário — bora quebrar recordes.</p>
        </div>
        <StreakBadge streak={streak} />
      </div>

      {/* Missão do dia */}
      <MissionBanner target={target} done={today.calls_made} remaining={remaining} pct={pct} complete={done} />

      {/* Anéis KPI */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <RingCard
          title="Ligações"
          done={today.calls_made}
          target={target}
          color={done ? "#10b981" : "var(--primary)"}
          glow={done}
          hint={done ? "🚀 Meta batida hoje" : `de ${target}`}
          icon={<Target className="h-4 w-4" />}
        />
        <RingCard
          title="Decisores"
          done={today.decisions_reached}
          target={targetDec}
          color="#8b5cf6"
          hint={`de ${targetDec || "—"}`}
          badge={badgeForRate(realCallToDec, goal ? Number(goal.rate_call_to_decision) : 0)}
          icon={<Sparkles className="h-4 w-4" />}
        />
        <RingCard
          title="Agendadas"
          done={today.meetings_scheduled}
          target={targetMeet}
          color="#f59e0b"
          hint={`de ${targetMeet || "—"}`}
          icon={<Trophy className="h-4 w-4" />}
        />
        <RingCard
          title="Fechamentos"
          done={today.closes}
          target={Math.max(1, nums?.monthly.closes ? Math.ceil((nums.monthly.closes) / (nums.workingDaysPerMonth || 20)) : 1)}
          color="#059669"
          hint={today.closes === 0 ? "O próximo está perto! 🎯" : "hoje"}
          icon={<Trophy className="h-4 w-4" />}
        />
      </div>

      {/* Insights + heatmap */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Poderes do funil" subtitle="Sua conversão real vs. estimativa">
          <div className="space-y-3">
            <InsightRow label="Ligação → Decisor" est={goal ? Number(goal.rate_call_to_decision) : 0} real={realCallToDec} />
            <InsightRow label="Decisor → Reunião" est={goal ? Number(goal.rate_decision_to_meeting) : 0} real={realDecToMeet} />
          </div>
          {nums && (
            <div className="mt-5 rounded-2xl border border-[color:var(--border-subtle)] bg-primary/5 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-primary">
                <CalendarCheck className="h-4 w-4" /> Missão diária calibrada
              </div>
              <p className="mt-1 text-muted-foreground">
                Meta atual: <b className="text-foreground">{nums.daily.calls} ligações/dia</b> ·
                {" "}{nums.daily.decisions} decisores · {nums.daily.meetingsSched} agendamento(s).
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Não quebre a corrente" subtitle="Últimos 30 dias">
          <div className="grid grid-cols-10 gap-1.5">
            {chain.map((c, i) => (
              <div
                key={c.day}
                title={`${new Date(c.day).toLocaleDateString("pt-BR")} · ${c.calls} ligações`}
                className={`aspect-square rounded-md transition-all ${cellClass(c.pct)}`}
                style={{ animationDelay: `${i * 12}ms` }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Menos</span>
            <div className="flex items-center gap-1">
              {[0, 0.25, 0.5, 0.75, 1].map((p) => (
                <span key={p} className={`h-3 w-3 rounded-[3px] ${cellClass(p)}`} />
              ))}
            </div>
            <span>Mais</span>
          </div>

          <div className="mt-5 h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last14} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="d" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "color-mix(in oklab, var(--primary) 8%, transparent)" }}
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border-subtle, #e5e7eb)", fontSize: 12 }}
                />
                <Bar dataKey="calls" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function StreakBadge({ streak }: { streak: number }) {
  if (streak <= 0) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-white/70 px-4 py-2 text-sm font-semibold text-muted-foreground shadow-[var(--shadow-glass)] backdrop-blur-xl">
        <Flame className="h-4 w-4" /> Comece uma sequência hoje
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2 text-sm font-bold text-white shadow-[0_10px_30px_-12px_rgba(244,63,94,0.6)]">
      <Flame className="h-4 w-4" /> {streak} dias batendo a meta
    </div>
  );
}

function MissionBanner({ target, done, remaining, pct, complete }: { target: number; done: number; remaining: number; pct: number; complete: boolean }) {
  return (
    <div className="animate-fade-in rounded-3xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-white/80 to-[color:var(--primary)]/6 p-6 shadow-[var(--shadow-glass)] backdrop-blur-xl">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Missão do dia</div>
          <p className="mt-2 text-lg font-semibold leading-snug sm:text-xl">
            {target === 0
              ? "Configure sua meta em Números de Ouro para desbloquear a missão."
              : complete
                ? <>Meta batida! Vá para <b>{Math.ceil(target * 1.2)}</b> e desbloqueie o modo lendário 👑</>
                : <>Sua meta diária é de <b>{target}</b> ligações. Faltam <b className="text-primary">{remaining}</b> para bater a meta. Bora pra cima! 🚀</>}
          </p>
        </div>
        <div className="text-right font-black tabular-nums" style={{ fontWeight: 900 }}>
          <div className="text-4xl leading-none">{pct}%</div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">progresso</div>
        </div>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-primary/10">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${complete ? "bg-gradient-to-r from-emerald-400 to-emerald-600" : "bg-gradient-to-r from-[color:var(--primary)] to-[color:var(--primary-glow)]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{done} / {target}</span>
        <span>{complete ? "🔥 Você está on fire" : `Faltam ${remaining}`}</span>
      </div>
    </div>
  );
}

function RingCard({ title, done, target, color, glow, hint, badge, icon }: {
  title: string; done: number; target: number; color: string; glow?: boolean; hint?: string; badge?: React.ReactNode; icon?: React.ReactNode;
}) {
  return (
    <Card className="relative animate-fade-in overflow-hidden rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
            {title}
          </div>
          {badge}
        </div>
        <div className="mt-3 grid place-items-center">
          <RadialProgress value={done} max={Math.max(1, target)} color={color} glow={glow} size={132} stroke={12}>
            <div>
              <div className="text-3xl font-black tabular-nums" style={{ fontWeight: 900 }}>{done}</div>
              {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
            </div>
          </RadialProgress>
        </div>
      </CardContent>
    </Card>
  );
}

function badgeForRate(real: number, est: number) {
  if (est <= 0) return null;
  const deltaPct = (real - est) * 100;
  if (Math.abs(deltaPct) < 2) return null;
  if (deltaPct > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">
        🔥 +{Math.round(deltaPct)}pp
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-1 text-[10px] font-bold text-orange-700">
      ⚠️ {Math.round(deltaPct)}pp
    </span>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="animate-fade-in rounded-3xl border border-[color:var(--border-subtle)] bg-white/70 p-6 shadow-[var(--shadow-glass)] backdrop-blur-xl">
      <div className="mb-4">
        <div className="text-lg font-bold tracking-tight">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function InsightRow({ label, est, real }: { label: string; est: number; real: number }) {
  const delta = real - est;
  const deltaPct = Math.round(delta * 100);
  const stable = Math.abs(delta) < 0.02;
  const positive = delta > 0;
  const tone = stable ? "slate" : positive ? "emerald" : "orange";
  const Icon = stable ? Minus : positive ? Rocket : AlertTriangle;
  const message = stable
    ? "Estável — mantendo o ritmo."
    : positive
      ? `Voando! Conversão ${deltaPct}pp acima da estimativa.`
      : `Script precisa de ajuste — caiu ${Math.abs(deltaPct)}pp.`;

  const tones: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
  };
  const bars: Record<string, string> = {
    emerald: "bg-emerald-500",
    orange: "bg-orange-500",
    slate: "bg-slate-400",
  };

  return (
    <div className={`rounded-2xl border p-3 ${tones[tone]}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <span className="text-xs font-bold tabular-nums">
          {positive && !stable ? "+" : ""}{deltaPct}pp
        </span>
      </div>
      <p className="mt-1 text-xs">{message}</p>
      <div className="mt-3 space-y-1">
        <MiniBar label="Est." value={est} color="bg-slate-300" />
        <MiniBar label="Real" value={real} color={bars[tone]} />
      </div>
    </div>
  );
}

function MiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-8 text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/70">
        <div className={`h-full rounded-full ${color} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right tabular-nums font-semibold">{pct}%</span>
    </div>
  );
}

function cellClass(pct: number): string {
  if (pct <= 0) return "bg-muted/50";
  if (pct < 0.25) return "bg-primary/20";
  if (pct < 0.5) return "bg-primary/40";
  if (pct < 0.75) return "bg-primary/60";
  if (pct < 1) return "bg-primary/80";
  return "bg-primary shadow-[0_0_12px_-2px_var(--primary)]";
}