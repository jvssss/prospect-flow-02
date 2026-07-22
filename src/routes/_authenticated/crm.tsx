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
  Trophy, UserX, RefreshCcw, Users, Clock, CheckCheck,
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
      <Input value={q} onChange={(e) => onChange(e.target.value)} placeholder="Buscar por nome, empresa, telefone…" className="rounded-full pl-9 h-11 bg-white/70 backdrop-blur-xl border-[color:var(--border-subtle)]" />
    </div>
  );
}

/* ---------------- SDR Board ---------------- */

const SDR_STAGES = [
  { key: "activate", label: "Ativar", icon: Flame, accent: "bg-primary/10 text-primary", bar: "bg-primary" },
  { key: "in_contact", label: "Em Contato", icon: MessageCircle, accent: "bg-blue-100 text-blue-700", bar: "bg-blue-500" },
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
    const m: Record<string, any[]> = { activate: [], in_contact: [], scheduled: [], dismissed: [] };
    for (const l of leads) (m[l.pipeline_stage] ?? m.activate).push(l);
    return m;
  }, [leads]);

  const totals = {
    total: totalLeads,
    in_contact: byStage.in_contact.length,
    scheduled: byStage.scheduled.length,
    dismissed: byStage.dismissed.length,
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi tone="primary" label="Total de leads" value={totals.total} sub="no funil do SDR" icon={Flame} />
        <Kpi label="Em contato" value={totals.in_contact} sub="sendo trabalhados" icon={MessageCircle} />
        <Kpi label="Agendados" value={totals.scheduled} sub="prontos para o closer" icon={CalendarCheck} />
        <Kpi label="Dispensados" value={totals.dismissed} sub="arquivados" icon={XCircle} />
      </div>
      <BoardPanel title="Pipeline SDR" search={search}>
        <KanbanGrid>
          {SDR_STAGES.map((s) => {
            const list = byStage[s.key] ?? [];
            return (
              <Column key={s.key} label={s.label} count={list.length}>
                {list.map((l) => (
                  <LeadCard key={l.id} lead={l} onOpen={() => onOpen(l)} onMove={(stage) => move.mutate({ leadId: l.id, pipeline_stage: stage })} showSdrActions />
                ))}
                {list.length === 0 && <EmptyCol />}
              </Column>
            );
          })}
        </KanbanGrid>
      </BoardPanel>
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
      <BoardPanel title="Pipeline Closer" search={search}>
        <KanbanGrid>
          {CLOSER_STAGES.map((s) => {
            const list = byStage[s.key] ?? [];
            return (
              <Column key={s.key} label={s.label} count={list.length}>
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
                {list.length === 0 && <EmptyCol text="Sem leads nesta etapa" />}
              </Column>
            );
          })}
        </KanbanGrid>
      </BoardPanel>
    </>
  );
}

/* ---------------- Shared building blocks ---------------- */

function Kpi({ label, value, sub, icon: Icon, tone }: any) {
  const primary = tone === "primary";
  return (
    <Card className={`overflow-hidden rounded-3xl border-[color:var(--border-subtle)] shadow-[var(--shadow-glass)] backdrop-blur-xl ${primary ? "bg-gradient-to-br from-primary to-[color:var(--primary-glow)] text-primary-foreground" : "bg-white/70"}`}>
      <CardContent className="relative p-5">
        {primary && <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />}
        {primary && <div className="pointer-events-none absolute -right-10 bottom-0 h-16 w-16 rounded-full bg-white/10" />}
        <div className={`mb-3 grid h-10 w-10 place-items-center rounded-2xl ${primary ? "bg-white/20 text-white" : "bg-primary/10 text-primary"}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${primary ? "text-white/80" : "text-muted-foreground"}`}>{label}</div>
        <div className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums">{value}</div>
        <div className={`mt-1 text-xs ${primary ? "text-white/80" : "text-muted-foreground"}`}>{sub}</div>
      </CardContent>
    </Card>
  );
}

function BoardPanel({ title, search, children }: { title: string; search: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-[2rem] border border-[color:var(--border-subtle)] bg-white/45 p-4 shadow-[var(--shadow-glass)] backdrop-blur-2xl md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-lg font-bold tracking-tight">{title}</div>
        <div className="flex-1 md:max-w-md md:ml-auto">{search}</div>
      </div>
      {children}
    </div>
  );
}

function KanbanGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {children}
    </div>
  );
}

function Column({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="mb-3 flex justify-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-white/70 px-4 py-1.5 text-xs font-semibold text-foreground shadow-[var(--shadow-glass)] backdrop-blur-xl">
          <span>{label}</span>
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-foreground/10 px-1.5 text-[10px] font-bold tabular-nums text-foreground/80">{count}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1" style={{ maxHeight: "70vh" }}>
        {children}
      </div>
    </div>
  );
}

function EmptyCol({ text = "Sem leads nesta etapa." }: { text?: string }) {
  return <div className="rounded-full border border-dashed border-white/60 bg-white/30 px-4 py-6 text-center text-xs text-muted-foreground backdrop-blur">{text}</div>;
}

function LeadCard({ lead, onOpen, onMove, onCloserAction, showSdrActions, showCloserActions }: {
  lead: any; onOpen: () => void;
  onMove?: (s: string) => void; onCloserAction?: (a: "held" | "no_show" | "won" | "reschedule") => void;
  showSdrActions?: boolean; showCloserActions?: boolean;
}) {
  const initial = (lead.nome_fantasia || lead.razao_social || "?").trim().charAt(0).toUpperCase();
  const meetingDate = lead.meeting_at ? new Date(lead.meeting_at) : null;
  const daysAgo = meetingDate ? Math.round((Date.now() - meetingDate.getTime()) / 86400000) : null;
  const isWon = lead.meeting_result === "won";
  const sub = lead.cidade
    ? (meetingDate ? `${lead.cidade} · ${daysAgo === 0 ? "hoje" : daysAgo && daysAgo > 0 ? `há ${daysAgo}d` : `em ${-(daysAgo ?? 0)}d`}` : lead.cidade)
    : (lead.telefone_1 ? formatPhoneBR(lead.telefone_1) : "");

  return (
    <div
      onClick={onOpen}
      className="group cursor-pointer rounded-full border border-white/70 bg-white/80 py-2 pl-2 pr-3 shadow-[0_2px_8px_-4px_rgb(15_23_42_/_0.08)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[var(--shadow-glass)]"
    >
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-[color:var(--primary-glow)] text-sm font-bold text-primary-foreground shadow-[0_4px_10px_-4px_color-mix(in_oklab,var(--primary)_50%,transparent)]">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold tracking-tight">{lead.nome_fantasia ?? lead.razao_social ?? "Novo lead"}</div>
          <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
        </div>
        <div className="shrink-0 pl-1">
          {isWon
            ? <CheckCheck className="h-4 w-4 text-emerald-600" />
            : meetingDate
              ? <CalendarCheck className="h-4 w-4 text-emerald-500" />
              : lead.followup_at
                ? <RefreshCcw className="h-4 w-4 text-violet-500" />
                : <Clock className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {showSdrActions && onMove && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-1 pl-12" onClick={(e) => e.stopPropagation()}>
          {lead.pipeline_stage !== "in_contact" && (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs" onClick={() => onMove("in_contact")}>Em contato</Button>
          )}
          {lead.pipeline_stage !== "dismissed" && (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs text-amber-700" onClick={() => onMove("dismissed")}>Dispensar</Button>
          )}
        </div>
      )}

      {showCloserActions && onCloserAction && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-1 pl-12" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs text-emerald-700" onClick={() => onCloserAction("won")}>Ganho</Button>
          <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs text-rose-700" onClick={() => onCloserAction("no_show")}>No-Show</Button>
          <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs text-violet-700" onClick={() => onCloserAction("reschedule")}>Follow-up</Button>
        </div>
      )}
    </div>
  );
}