import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { computeGoldenNumbers, formatBRL, formatSeconds, type GoalsInput } from "@/lib/goldenMath";

export const Route = createFileRoute("/_authenticated/goals")({
  head: () => ({
    meta: [
      { title: "Números de Ouro · Meta Prospect" },
      { name: "description", content: "Traduza sua meta mensal em ligações, decisores e reuniões por dia." },
    ],
  }),
  component: GoalsPage,
});

const DEFAULTS: GoalsInput = {
  monthlyRevenueTarget: 30000,
  avgTicket: 1500,
  prospectingDaysPerWeek: 5,
  hoursPerDay: 2,
  rateCallToDecision: 0.30,
  rateDecisionToMeeting: 0.20,
  rateShowUp: 0.70,
  rateMeetingToClose: 0.25,
};

function GoalsPage() {
  const qc = useQueryClient();
  const { data: goal } = useQuery({
    queryKey: ["goals-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goals_math").select("*").eq("is_active", true)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<GoalsInput>(DEFAULTS);

  useEffect(() => {
    if (goal) {
      setForm({
        monthlyRevenueTarget: Number(goal.monthly_revenue_target),
        avgTicket: Number(goal.avg_ticket),
        prospectingDaysPerWeek: Number(goal.prospecting_days_per_week),
        hoursPerDay: Number(goal.hours_per_day),
        rateCallToDecision: Number(goal.rate_call_to_decision),
        rateDecisionToMeeting: Number(goal.rate_decision_to_meeting),
        rateShowUp: Number(goal.rate_show_up),
        rateMeetingToClose: Number(goal.rate_meeting_to_close),
      });
    }
  }, [goal]);

  const nums = useMemo(() => computeGoldenNumbers(form), [form]);

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sem sessão");
      const payload = {
        user_id: u.user.id, is_active: true,
        monthly_revenue_target: form.monthlyRevenueTarget, avg_ticket: form.avgTicket,
        prospecting_days_per_week: form.prospectingDaysPerWeek, hours_per_day: form.hoursPerDay,
        rate_call_to_decision: form.rateCallToDecision, rate_decision_to_meeting: form.rateDecisionToMeeting,
        rate_show_up: form.rateShowUp, rate_meeting_to_close: form.rateMeetingToClose,
      };
      if (goal?.id) {
        const { error } = await supabase.from("goals_math").update(payload).eq("id", goal.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("goals_math").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Números de Ouro atualizados"); qc.invalidateQueries({ queryKey: ["goals-active"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const num = (k: keyof GoalsInput, v: string) => setForm((f) => ({ ...f, [k]: Number(v) }));
  const pct = (k: keyof GoalsInput, v: string) => setForm((f) => ({ ...f, [k]: Math.max(0, Math.min(100, Number(v))) / 100 }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Números de Ouro</h1>
        <p className="mt-1 text-muted-foreground">Sua meta, seu funil, seu tempo → o que fazer hoje.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card className="rounded-3xl border-border shadow-[var(--shadow-soft)]">
          <CardHeader><CardTitle>Sua realidade</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Meta mensal (R$)</Label><Input type="number" className="rounded-xl" value={form.monthlyRevenueTarget} onChange={(e) => num("monthlyRevenueTarget", e.target.value)} /></div>
              <div><Label>Ticket médio (R$)</Label><Input type="number" className="rounded-xl" value={form.avgTicket} onChange={(e) => num("avgTicket", e.target.value)} /></div>
              <div><Label>Dias de prospecção / semana</Label><Input type="number" min={1} max={7} className="rounded-xl" value={form.prospectingDaysPerWeek} onChange={(e) => num("prospectingDaysPerWeek", e.target.value)} /></div>
              <div><Label>Horas / dia</Label><Input type="number" step={0.5} className="rounded-xl" value={form.hoursPerDay} onChange={(e) => num("hoursPerDay", e.target.value)} /></div>
            </div>
            <div className="rounded-2xl bg-accent/60 p-4">
              <p className="mb-3 text-sm font-medium text-accent-foreground">Funil estimado (%)</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Ligações → Decisor</Label><Input type="number" min={1} max={100} className="rounded-xl" value={Math.round(form.rateCallToDecision * 100)} onChange={(e) => pct("rateCallToDecision", e.target.value)} /></div>
                <div><Label>Decisor → Reunião</Label><Input type="number" min={1} max={100} className="rounded-xl" value={Math.round(form.rateDecisionToMeeting * 100)} onChange={(e) => pct("rateDecisionToMeeting", e.target.value)} /></div>
                <div><Label>Show-up</Label><Input type="number" min={1} max={100} className="rounded-xl" value={Math.round(form.rateShowUp * 100)} onChange={(e) => pct("rateShowUp", e.target.value)} /></div>
                <div><Label>Realizada → Fechamento</Label><Input type="number" min={1} max={100} className="rounded-xl" value={Math.round(form.rateMeetingToClose * 100)} onChange={(e) => pct("rateMeetingToClose", e.target.value)} /></div>
              </div>
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full rounded-2xl bg-primary shadow-[var(--shadow-elegant)]">Salvar Números de Ouro</Button>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border bg-gradient-to-br from-primary to-[color:var(--primary-glow)] text-primary-foreground shadow-[var(--shadow-elegant)]">
          <CardHeader><CardTitle className="text-primary-foreground">Sua meta diária</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-wide opacity-80">Ligações / dia</p>
              <p className="text-6xl font-bold tracking-tight">{nums.daily.calls}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Mini label="Decisores / dia" value={nums.daily.decisions} />
              <Mini label="Agendadas / dia" value={nums.daily.meetingsSched} />
              <Mini label="Tempo / ligação" value={formatSeconds(nums.daily.secondsPerCall)} />
              <Mini label="Dias úteis / mês" value={nums.workingDaysPerMonth} />
            </div>
            <div className="mt-4 border-t border-white/20 pt-4">
              <p className="text-xs uppercase tracking-wide opacity-80">No mês</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <span>{nums.monthly.calls} ligações</span>
                <span>{nums.monthly.decisions} decisores</span>
                <span>{nums.monthly.meetingsSched} agendadas</span>
                <span>{nums.monthly.meetingsHeld} realizadas</span>
                <span>{nums.monthly.closes} vendas</span>
                <span className="font-semibold">{formatBRL(nums.monthly.revenue)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-white/10 p-3">
      <p className="text-[11px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}