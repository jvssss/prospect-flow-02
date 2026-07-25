import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Search, Flame, MessageCircle, CalendarCheck, XCircle,
  Trophy, UserX, RefreshCcw, Users, RotateCcw,
} from "lucide-react";
import { updateLeadStage, updateMeeting } from "@/lib/qualification.functions";
import { formatPhoneBR } from "@/lib/goldenMath";
import { toast } from "sonner";
import { LeadDetailDialog } from "@/components/lead-detail-dialog";

type Board = "sdr" | "closer";

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM · Meta Prospect" }] }),
  component: CrmPage,
});

function CrmPage() {
  const [board, setBoard] = useState<Board>("sdr");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<any | null>(null);

  const { data: leads = [] } = useQuery({
    queryKey: ["crm-leads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!q) return leads;
    const t = q.toLowerCase();
    return leads.filter((l: any) =>
      [l.nome_fantasia, l.razao_social, l.proprietario, l.telefone_1, l.cidade, l.bairro]
        .filter(Boolean).some((s: any) => String(s).toLowerCase().includes(t)),
    );
  }, [leads, q]);

  return (
    <div className="mx-auto max-w-[1500px] px-6 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            {board === "sdr" ? "Tela do SDR" : "Tela do Closer"}
          </div>
          <h1 className="mt-1 text-4xl tracking-tight md:text-5xl">
            {board === "sdr" ? "Prospecção de leads" : "Fechamento de vendas"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {board === "sdr" ? "Organize a jornada até o agendamento." : "Do agendamento ao contrato assinado."}
          </p>
        </div>

        <div className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-white/70 p-1 shadow-[var(--shadow-glass)] backdrop-blur-xl">
          <PillBtn active={board === "sdr"} onClick={() => setBoard("sdr")} icon={Users} label="SDR" />
          <PillBtn active={board === "closer"} onClick={() => setBoard("closer")} icon={Trophy} label="Closer" />
        </div>
      </div>

      <div className="mt-6">
        {board === "sdr"
          ? <SdrBoard leads={filtered} totalLeads={leads.length} onOpen={setSelected} search={<SearchBar q={q} onChange={setQ} />} />
          : <CloserBoard leads={filtered} totalLeads={leads.length} onOpen={setSelected} search={<SearchBar q={q} onChange={setQ} />} />}
      </div>

      <LeadDetailDialog lead={selected} open={!!selected} onOpenChange={(v) => !v && setSelected(null)} />
    </div>
  );
}

function PillBtn({ active, onClick, icon: Icon, label }: any) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
        active ? "bg-foreground text-background shadow-[var(--shadow-soft)]" : "text-muted-foreground hover:text-foreground"
      }`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function SearchBar({ q, onChange }: { q: string; onChange: (v: string) => void }) {
  return (
    <div className="relative max-w-lg">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(e) => onChange(e.target.value)} placeholder="Buscar por nome, empresa, telefone…" className="rounded-full pl-9 h-11 bg-card" />
    </div>
  );
}

/* ---------------- SDR Board ---------------- */

const SDR_STAGES = [
  { key: "activate", label: "Ativar", icon: Flame, accent: "bg-primary/10 text-primary", bar: "bg-primary" },
  { key: "in_contact", label: "Em Contato", icon: MessageCircle, accent: "bg-blue-100 text-blue-700", bar: "bg-blue-500" },
  { key: "followup", label: "Follow-ups", icon: RotateCcw, accent: "bg-violet-100 text-violet-700", bar: "bg-violet-500" },
  { key: "scheduled", label: "Agendou", icon: CalendarCheck, accent: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
  { key: "dismissed", label: "Dispensou", icon: XCircle, accent: "bg-amber-100 text-amber-700", bar: "bg-amber-500" },
] as const;

function SdrBoard({ leads, totalLeads, onOpen, search }: { leads: any[]; totalLeads: number; onOpen: (l: any) => void; search: React.ReactNode }) {
  const qc = useQueryClient();
  const setStage = useServerFn(updateLeadStage);
  const move = useMutation({
    mutationFn: async (p: { leadId: string; pipeline_stage: any }) => setStage({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-leads"] }),
    onError: (e: any) => toast.error(e?.message ?? "Falha ao mover"),
  });

  const byStage = useMemo(() => {
    const m: Record<string, any[]> = { activate: [], in_contact: [], followup: [], scheduled: [], dismissed: [] };
    for (const l of leads) {
      const isFollowup =
        (l.pipeline_stage === "activate" || l.pipeline_stage === "in_contact") &&
        (!!l.followup_at || !!l.proprietario);
      if (isFollowup) m.followup.push(l);
      else (m[l.pipeline_stage] ?? m.activate).push(l);
    }
    // Follow-ups: mais próximos primeiro
    m.followup.sort((a, b) => {
      const ta = a.followup_at ? new Date(a.followup_at).getTime() : Infinity;
      const tb = b.followup_at ? new Date(b.followup_at).getTime() : Infinity;
      return ta - tb;
    });
    return m;
  }, [leads]);

  const totals = {
    total: totalLeads,
    in_contact: byStage.in_contact.length,
    followup: byStage.followup.length,
    scheduled: byStage.scheduled.length,
    dismissed: byStage.dismissed.length,
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Kpi tone="primary" label="Total de leads" value={totals.total} sub="no funil do SDR" icon={Flame} />
        <Kpi label="Em contato" value={totals.in_contact} sub="sendo trabalhados" icon={MessageCircle} />
        <Kpi label="Follow-ups" value={totals.followup} sub="decisor mapeado" icon={RotateCcw} />
        <Kpi label="Agendados" value={totals.scheduled} sub="prontos para o closer" icon={CalendarCheck} />
        <Kpi label="Dispensados" value={totals.dismissed} sub="arquivados" icon={XCircle} />
      </div>
      <div className="mt-6">{search}</div>
      <div className="mt-4">
        <StatusLegend />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {SDR_STAGES.map((s) => {
          const list = byStage[s.key] ?? [];
          const Icon = s.icon;
          return (
            <Column key={s.key} icon={Icon} label={s.label} count={list.length} accent={s.accent} bar={s.bar}>
              {list.map((l) => (
                <LeadCard key={l.id} lead={l} onOpen={() => onOpen(l)} onMove={(stage) => move.mutate({ leadId: l.id, pipeline_stage: stage })} showSdrActions />
              ))}
              {list.length === 0 && <EmptyCol />}
            </Column>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- Closer Board ---------------- */

const CLOSER_STAGES = [
  { key: "scheduled", label: "Agendados", icon: CalendarCheck, accent: "bg-primary/10 text-primary", bar: "bg-primary" },
  { key: "no_show", label: "No-Show", icon: UserX, accent: "bg-rose-100 text-rose-700", bar: "bg-rose-500" },
  { key: "won", label: "Fechados", icon: Trophy, accent: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
  { key: "followup", label: "Follow-up", icon: RefreshCcw, accent: "bg-violet-100 text-violet-700", bar: "bg-violet-500" },
] as const;

function CloserBoard({ leads, totalLeads, onOpen, search }: { leads: any[]; totalLeads: number; onOpen: (l: any) => void; search: React.ReactNode }) {
  const qc = useQueryClient();
  const upd = useServerFn(updateMeeting);
  const setStatus = useMutation({
    mutationFn: async (p: any) => upd({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-leads"] }),
    onError: (e: any) => toast.error(e?.message ?? "Falha ao atualizar"),
  });

  const closerLeads = useMemo(() => leads.filter((l) => l.pipeline_stage === "scheduled"), [leads]);

  const byStage = useMemo(() => {
    const m: Record<string, any[]> = { scheduled: [], no_show: [], won: [], followup: [] };
    for (const l of closerLeads) {
      if (l.meeting_result === "won") m.won.push(l);
      else if (l.meeting_status === "no_show") m.no_show.push(l);
      else if (l.meeting_status === "rescheduled") m.followup.push(l);
      else m.scheduled.push(l);
    }
    return m;
  }, [closerLeads]);

  const closingRate = closerLeads.length ? Math.round((byStage.won.length / closerLeads.length) * 100) : 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi tone="primary" label="Taxa de fechamento" value={`${closingRate}%`} sub={`${byStage.won.length} de ${closerLeads.length} leads`} icon={Trophy} />
        <Kpi label="Agendados" value={byStage.scheduled.length} sub="aguardando reunião" icon={CalendarCheck} />
        <Kpi label="No-Show" value={byStage.no_show.length} sub="não compareceram" icon={UserX} />
        <Kpi label="Follow-up" value={byStage.followup.length} sub="em acompanhamento" icon={RefreshCcw} />
      </div>
      <div className="mt-6">{search}</div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {CLOSER_STAGES.map((s) => {
          const list = byStage[s.key] ?? [];
          const Icon = s.icon;
          return (
            <Column key={s.key} icon={Icon} label={s.label} count={list.length} accent={s.accent} bar={s.bar}>
              {list.map((l) => (
                <LeadCard key={l.id} lead={l} onOpen={() => onOpen(l)}
                  onCloserAction={(action) => {
                    if (action === "held") setStatus.mutate({ leadId: l.id, meeting_status: "held" });
                    if (action === "no_show") setStatus.mutate({ leadId: l.id, meeting_status: "no_show" });
                    if (action === "won") setStatus.mutate({ leadId: l.id, meeting_status: "held", meeting_result: "won" });
                    if (action === "reschedule") setStatus.mutate({ leadId: l.id, meeting_status: "rescheduled" });
                  }}
                  showCloserActions={s.key !== "won"}
                />
              ))}
              {list.length === 0 && <EmptyCol text="Arraste um lead para cá" />}
            </Column>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- Shared building blocks ---------------- */

function Kpi({ label, value, sub, icon: Icon, tone }: any) {
  const primary = tone === "primary";
  return (
    <Card className={`overflow-hidden rounded-3xl border-border shadow-[var(--shadow-soft)] ${primary ? "bg-gradient-to-br from-primary to-[color:var(--primary-glow)] text-primary-foreground" : "bg-card"}`}>
      <CardContent className="relative p-5">
        {primary && <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />}
        {primary && <div className="pointer-events-none absolute -right-10 bottom-0 h-16 w-16 rounded-full bg-white/10" />}
        <div className={`mb-3 grid h-10 w-10 place-items-center rounded-2xl ${primary ? "bg-white/20 text-white" : "bg-primary/10 text-primary"}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className={`text-[10px] font-medium uppercase tracking-widest ${primary ? "text-white/80" : "text-muted-foreground"}`}>{label}</div>
        <div className="mt-1 text-3xl font-bold tabular-nums">{value}</div>
        <div className={`mt-1 text-xs ${primary ? "text-white/80" : "text-muted-foreground"}`}>{sub}</div>
      </CardContent>
    </Card>
  );
}

function Column({ icon: Icon, label, count, accent, bar, children }: any) {
  return (
    <div className="flex flex-col rounded-3xl border border-[color:var(--border-subtle)] bg-white/60 p-3 shadow-[var(--shadow-glass)] backdrop-blur-xl">
      <div className="px-2 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`grid h-8 w-8 place-items-center rounded-xl ${accent}`}><Icon className="h-4 w-4" /></div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Estágio</div>
              <div className="font-semibold">{label}</div>
            </div>
          </div>
          <Badge variant="secondary" className="rounded-full">{count}</Badge>
        </div>
        <div className={`mt-3 h-1 rounded-full ${bar}`} />
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1" style={{ maxHeight: "70vh" }}>
        {children}
      </div>
    </div>
  );
}

function EmptyCol({ text = "Sem leads nesta etapa." }: { text?: string }) {
  return <div className="rounded-2xl border border-dashed p-6 text-center text-xs text-muted-foreground">{text}</div>;
}

function LeadCard({ lead, onOpen, onMove, onCloserAction, showSdrActions, showCloserActions }: {
  lead: any; onOpen: () => void;
  onMove?: (s: string) => void; onCloserAction?: (a: "held" | "no_show" | "won" | "reschedule") => void;
  showSdrActions?: boolean; showCloserActions?: boolean;
}) {
  const initial = (lead.nome_fantasia || lead.razao_social || "?").trim().charAt(0).toUpperCase();
  const meetingDate = lead.meeting_at ? new Date(lead.meeting_at) : null;
  const daysAgo = meetingDate ? Math.round((Date.now() - meetingDate.getTime()) / 86400000) : null;
  const accent = accentFor(lead);

  return (
    <div
      onClick={onOpen}
      className={`group cursor-pointer rounded-2xl border border-border border-l-4 ${accent} bg-background p-3 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]`}
    >
      <div className="flex items-start gap-2">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-sm font-bold text-primary">{initial}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{lead.nome_fantasia ?? lead.razao_social ?? "Novo lead"}</div>
          {lead.proprietario && <div className="truncate text-xs text-muted-foreground">{lead.proprietario}</div>}
          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {lead.telefone_1 && <div className="tabular-nums">📞 {formatPhoneBR(lead.telefone_1)}</div>}
            {lead.cidade && <div>📍 {lead.cidade}</div>}
            {lead.nome_ponte && <div>🛎 Atendente: {lead.nome_ponte}</div>}
            {lead.followup_at && (
              <div className="flex items-center gap-1 text-violet-700">
                🔁 Follow-up: {new Date(lead.followup_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                {lead.followup_notes ? <span className="truncate text-muted-foreground"> · {lead.followup_notes}</span> : null}
              </div>
            )}
            {meetingDate && (
              <div className="flex items-center justify-between text-emerald-700">
                <span>🗓 {meetingDate.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                {daysAgo !== null && <span className="text-muted-foreground">{daysAgo === 0 ? "hoje" : daysAgo > 0 ? `há ${daysAgo}d` : `em ${-daysAgo}d`}</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {showSdrActions && onMove && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {lead.pipeline_stage !== "in_contact" && (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs" onClick={() => onMove("in_contact")}>Em contato</Button>
          )}
          {lead.pipeline_stage !== "dismissed" && (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs text-amber-700" onClick={() => onMove("dismissed")}>Dispensar</Button>
          )}
        </div>
      )}

      {showCloserActions && onCloserAction && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs text-emerald-700" onClick={() => onCloserAction("won")}>Ganho</Button>
          <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs text-rose-700" onClick={() => onCloserAction("no_show")}>No-Show</Button>
          <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs text-violet-700" onClick={() => onCloserAction("reschedule")}>Follow-up</Button>
        </div>
      )}
    </div>
  );
}