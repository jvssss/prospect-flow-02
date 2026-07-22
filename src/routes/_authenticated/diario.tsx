import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeGoldenNumbers, formatBRL, type GoalsInput } from "@/lib/goldenMath";

export const Route = createFileRoute("/_authenticated/diario")({
  head: () => ({
    meta: [
      { title: "Diário de Bordo · Meta Prospect" },
      { name: "description", content: "Compare conversão real vs. estimada e ajuste sua meta diária." },
    ],
  }),
  component: DiarioPage,
});

function DiarioPage() {
  const { data: goal } = useQuery({
    queryKey: ["goals-active"],
    queryFn: async () => {
      const { data } = await supabase.from("goals_math").select("*")
        .eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
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

  const totals = useMemo(() => metrics.reduce((a, m) => ({
    calls: a.calls + m.calls_made,
    decisions: a.decisions + m.decisions_reached,
    meetings: a.meetings + m.meetings_scheduled,
    held: a.held + m.meetings_held,
    closes: a.closes + m.closes,
  }), { calls: 0, decisions: 0, meetings: 0, held: 0, closes: 0 }), [metrics]);

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

  const realCallToDec = totals.calls ? totals.decisions / totals.calls : 0;
  const realDecToMeet = totals.decisions ? totals.meetings / totals.decisions : 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Feedback loop</div>
        <h1 className="mt-1 text-4xl tracking-tight md:text-5xl">Diário de Bordo</h1>
        <p className="mt-2 text-muted-foreground">Últimos 30 dias · realidade vs. estimativa</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Ligações" value={totals.calls} />
        <Kpi label="Decisores" value={totals.decisions} />
        <Kpi label="Agendadas" value={totals.meetings} />
        <Kpi label="Realizadas" value={totals.held} />
        <Kpi label="Fechamentos" value={totals.closes} highlight />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
          <CardHeader><CardTitle>Ajuste fino do funil</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Compare label="Ligação → Decisor" est={goal ? Number(goal.rate_call_to_decision) : 0} real={realCallToDec} />
            <Compare label="Decisor → Reunião" est={goal ? Number(goal.rate_decision_to_meeting) : 0} real={realDecToMeet} />
            {nums && (
              <p className="mt-4 rounded-2xl bg-accent/60 p-3 text-accent-foreground">
                Baseado na sua meta de {formatBRL(nums.monthly.revenue)}/mês, sua meta diária é
                <b> {nums.daily.calls} ligações</b>.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
          <CardHeader><CardTitle>Últimos dias</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {metrics.length === 0 && <p className="text-muted-foreground">Ainda sem registros. Vá para o Modo Foco e comece.</p>}
            {metrics.slice(0, 10).map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                <span className="font-medium">{new Date(m.day).toLocaleDateString("pt-BR")}</span>
                <span className="text-muted-foreground tabular-nums">{m.calls_made} calls · {m.meetings_scheduled} agendadas · {m.closes} fechada(s)</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card className={`rounded-3xl border-border ${highlight ? "bg-primary text-primary-foreground" : ""}`}>
      <CardContent className="p-5">
        <p className={`text-xs uppercase tracking-wide ${highlight ? "opacity-80" : "text-muted-foreground"}`}>{label}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function Compare({ label, est, real }: { label: string; est: number; real: number }) {
  const delta = real - est;
  const sign = delta >= 0 ? "+" : "";
  const color = Math.abs(delta) < 0.02 ? "text-muted-foreground" : delta > 0 ? "text-primary" : "text-destructive";
  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
      <span>{label}</span>
      <div className="flex items-center gap-3 tabular-nums">
        <span className="text-muted-foreground">Est. {Math.round(est * 100)}%</span>
        <span className="font-semibold">Real {Math.round(real * 100)}%</span>
        <span className={color}>{sign}{Math.round(delta * 100)}pp</span>
      </div>
    </div>
  );
}