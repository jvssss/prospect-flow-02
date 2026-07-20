import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Flame, MessageCircle, CalendarCheck, XCircle, ArrowRight, ChevronRight } from "lucide-react";
import { updateLeadStage } from "@/lib/qualification.functions";
import { formatPhoneBR } from "@/lib/goldenMath";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sdr")({
  head: () => ({ meta: [{ title: "CRM SDR · Meta Prospect" }] }),
  component: SdrBoard,
});

const STAGES = [
  { key: "activate", label: "Ativar", icon: Flame, tone: "bg-primary/10 text-primary" },
  { key: "in_contact", label: "Em Contato", icon: MessageCircle, tone: "bg-blue-100 text-blue-700" },
  { key: "scheduled", label: "Agendou", icon: CalendarCheck, tone: "bg-emerald-100 text-emerald-700" },
  { key: "dismissed", label: "Dispensou", icon: XCircle, tone: "bg-amber-100 text-amber-700" },
] as const;

function SdrBoard() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const { data: leads = [] } = useQuery({
    queryKey: ["sdr-leads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads")
        .select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const setStage = useServerFn(updateLeadStage);
  const move = useMutation({
    mutationFn: async (p: { leadId: string; pipeline_stage: any }) => setStage({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sdr-leads"] }),
    onError: (e: any) => toast.error(e?.message ?? "Falha ao mover"),
  });

  const filtered = useMemo(() => {
    if (!q) return leads;
    const t = q.toLowerCase();
    return leads.filter((l: any) =>
      [l.nome_fantasia, l.razao_social, l.proprietario, l.telefone_1, l.cidade, l.bairro]
        .filter(Boolean).some((s: any) => String(s).toLowerCase().includes(t)),
    );
  }, [leads, q]);

  const byStage = useMemo(() => {
    const m: Record<string, any[]> = { activate: [], in_contact: [], scheduled: [], dismissed: [] };
    for (const l of filtered) (m[l.pipeline_stage] ?? m.activate).push(l);
    return m;
  }, [filtered]);

  const totals = {
    total: leads.length,
    in_contact: byStage.in_contact.length,
    scheduled: byStage.scheduled.length,
    dismissed: byStage.dismissed.length,
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8">
      <div className="mb-2 text-xs font-medium uppercase tracking-widest text-primary">Tela do SDR</div>
      <h1 className="text-3xl font-bold tracking-tight">Prospecção de leads</h1>
      <p className="mt-1 text-muted-foreground">Organize a jornada até o agendamento.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi tone="primary" label="Total de leads" value={totals.total} sub="no funil do SDR" icon={Flame} />
        <Kpi label="Em contato" value={totals.in_contact} sub="sendo trabalhados" icon={MessageCircle} />
        <Kpi label="Agendados" value={totals.scheduled} sub="prontos para o closer" icon={CalendarCheck} />
        <Kpi label="Dispensados" value={totals.dismissed} sub="arquivados" icon={XCircle} />
      </div>

      <div className="mt-6 flex items-center gap-3">
        <div className="relative flex-1 max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, empresa, telefone…" className="rounded-2xl pl-9" />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((s) => {
          const list = byStage[s.key] ?? [];
          const Icon = s.icon;
          return (
            <div key={s.key} className="flex flex-col rounded-3xl border border-border bg-card p-3 shadow-[var(--shadow-soft)]">
              <div className="mb-3 flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <div className={`grid h-8 w-8 place-items-center rounded-xl ${s.tone}`}><Icon className="h-4 w-4" /></div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Estágio</div>
                    <div className="font-semibold">{s.label}</div>
                  </div>
                </div>
                <Badge variant="secondary" className="rounded-full">{list.length}</Badge>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1" style={{ maxHeight: "70vh" }}>
                {list.map((l: any) => (
                  <LeadCard key={l.id} lead={l} onMove={(stage) => move.mutate({ leadId: l.id, pipeline_stage: stage })} />
                ))}
                {list.length === 0 && (
                  <div className="rounded-2xl border border-dashed p-4 text-center text-xs text-muted-foreground">Sem leads nesta etapa.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, tone }: any) {
  const primary = tone === "primary";
  return (
    <Card className={`rounded-3xl border-border shadow-[var(--shadow-soft)] ${primary ? "bg-primary text-primary-foreground" : ""}`}>
      <CardContent className="p-5">
        <div className={`mb-3 grid h-9 w-9 place-items-center rounded-xl ${primary ? "bg-white/20 text-white" : "bg-primary/10 text-primary"}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className={`text-[10px] font-medium uppercase tracking-widest ${primary ? "text-white/80" : "text-muted-foreground"}`}>{label}</div>
        <div className="mt-1 text-3xl font-bold tabular-nums">{value}</div>
        <div className={`mt-1 text-xs ${primary ? "text-white/80" : "text-muted-foreground"}`}>{sub}</div>
      </CardContent>
    </Card>
  );
}

function LeadCard({ lead, onMove }: { lead: any; onMove: (s: string) => void }) {
  const initial = (lead.nome_fantasia || lead.razao_social || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="group rounded-2xl border border-border bg-background p-3 transition hover:shadow-[var(--shadow-soft)]">
      <div className="flex items-start gap-2">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-sm font-bold text-primary">{initial}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{lead.nome_fantasia ?? lead.razao_social ?? "Novo lead"}</div>
          {lead.proprietario && <div className="truncate text-xs text-muted-foreground">{lead.proprietario}</div>}
          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {lead.telefone_1 && <div className="tabular-nums">📞 {formatPhoneBR(lead.telefone_1)}</div>}
            {lead.cidade && <div>📍 {lead.cidade}{lead.bairro ? ` · ${lead.bairro}` : ""}</div>}
            {lead.meeting_at && (
              <div className="text-emerald-700">🗓 {new Date(lead.meeting_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Link to="/qualify/$leadId" params={{ leadId: lead.id }} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Qualificar <ArrowRight className="h-3 w-3" />
        </Link>
        <div className="flex items-center gap-1">
          {lead.pipeline_stage !== "in_contact" && (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs" onClick={() => onMove("in_contact")}>Em contato</Button>
          )}
          {lead.pipeline_stage !== "dismissed" && (
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-xs text-amber-700" onClick={() => onMove("dismissed")}>Dispensar</Button>
          )}
          {lead.pipeline_stage === "scheduled" && (
            <Link to="/closer/$leadId" params={{ leadId: lead.id }} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">
              Closer <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}