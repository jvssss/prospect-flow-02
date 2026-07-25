import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPhoneBR } from "@/lib/goldenMath";
import { enrichLeadCnpj } from "@/lib/enrichment.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  MapPin, User, Phone, Building2, Calendar, Sparkles, AlertTriangle, ArrowRight, RefreshCw, Loader2,
  MessageSquare, Target as TargetIcon, DollarSign, Users2, History, PhoneOff, VoicemailIcon, CalendarClock, Phone as PhoneIcon,
} from "lucide-react";

export function LeadDetailDialog({ lead, open, onOpenChange }: { lead: any | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  if (!lead) return null;
  const q: any = lead.sdr_qualification ?? {};
  const s: any = lead.closer_summary ?? {};
  const dores: any[] = Array.isArray(s.dores) ? s.dores : [];
  const meetingDate = lead.meeting_at ? new Date(lead.meeting_at) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-3xl p-0">
        <div className="rounded-t-3xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6">
          <DialogHeader>
            <div className="flex items-start gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-[var(--shadow-elegant)]">
                {(lead.nome_fantasia || lead.razao_social || "?").trim().charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-2xl font-bold tracking-tight">
                  {lead.nome_fantasia ?? lead.razao_social ?? "Lead"}
                </DialogTitle>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {lead.cidade && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {lead.cidade}{lead.bairro ? ` · ${lead.bairro}` : ""}</span>}
                  <Badge variant="secondary" className="rounded-full">{labelStage(lead.pipeline_stage)}</Badge>
                </div>
              </div>
            </div>
          </DialogHeader>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/qualify/$leadId" params={{ leadId: lead.id }} onClick={() => onOpenChange(false)}>
              <Button size="sm" className="rounded-full">Qualificar <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
            </Link>
            {lead.pipeline_stage === "scheduled" && (
              <Link to="/closer/$leadId" params={{ leadId: lead.id }} onClick={() => onOpenChange(false)}>
                <Button size="sm" variant="outline" className="rounded-full">Abrir Closer <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
              </Link>
            )}
            {lead.cnpj && <ReEnrichButton leadId={lead.id} />}
          </div>
        </div>

        <div className="px-6 pb-6">
          <Tabs defaultValue="info" className="mt-4">
            <TabsList className="rounded-full">
              <TabsTrigger value="info" className="rounded-full">Visão geral</TabsTrigger>
              <TabsTrigger value="history" className="rounded-full">Histórico</TabsTrigger>
              <TabsTrigger value="qual" className="rounded-full">Qualificação</TabsTrigger>
              <TabsTrigger value="closer" className="rounded-full">Closer</TabsTrigger>
            </TabsList>

            <TabsContent value="info" className="mt-4 grid gap-3 md:grid-cols-2">
              <Info icon={User} label="Proprietário" value={lead.proprietario} />
              <Info icon={Phone} label="Telefone" value={lead.telefone_1 ? formatPhoneBR(lead.telefone_1) : null} />
              <Info icon={Building2} label="Razão social" value={lead.razao_social} />
              <Info icon={MapPin} label="Endereço" value={[lead.cidade, lead.bairro].filter(Boolean).join(" · ")} />
              <Info icon={DollarSign} label="Capital social" value={lead.capital_social ? `R$ ${Number(lead.capital_social).toLocaleString("pt-BR")}` : null} />
              <Info icon={Calendar} label="Abertura" value={lead.data_abertura} />
              <Info icon={Users2} label="Sócios" value={sociosString(lead.socios)} full />
              <Info icon={User} label="Atendente / ponte" value={lead.nome_ponte} />
              {lead.followup_at && (
                <Info icon={Calendar} label="Follow-up" value={`${new Date(lead.followup_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}${lead.followup_notes ? " · " + lead.followup_notes : ""}`} full />
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              <CallHistory leadId={lead.id} lead={lead} />
            </TabsContent>

            <TabsContent value="qual" className="mt-4">
              {!q.matriculas_hoje ? (
                <Empty text="Este lead ainda não foi qualificado." />
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <Info label="Matrículas hoje" value={q.matriculas_hoje} />
                  <Info label="Antes da CNH Brasil" value={q.matriculas_antes_cnh_brasil} />
                  <Info label="Principal fonte" value={q.principal_fonte} />
                  <Info label="Investe em marketing" value={q.investe_marketing === "sim" ? "Sim" : q.investe_marketing === "nao" ? "Não" : null} />
                  <Info label="Maior desafio" value={q.maior_desafio} full />
                  <Info label="Responsável" value={q.responsavel} />
                </div>
              )}
            </TabsContent>

            <TabsContent value="closer" className="mt-4 space-y-4">
              {meetingDate && (
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm">
                  <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Reunião</div>
                  <div className="mt-1 text-lg font-semibold text-primary">
                    {meetingDate.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                  <div className="mt-1 text-xs">Status: {labelMeetingStatus(lead.meeting_status)}</div>
                </div>
              )}
              {!s.resumo ? (
                <Empty text="Nenhum resumo do closer gerado ainda." />
              ) : (
                <>
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Resumo IA</div>
                    <p className="mt-2 text-sm leading-relaxed">{s.resumo}</p>
                  </div>
                  {dores.length > 0 && (
                    <div className="grid gap-2 md:grid-cols-2">
                      {dores.map((d, i) => (
                        <div key={i} className={`rounded-2xl border p-3 text-sm ${toneFor(d.severidade)}`}>
                          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> {d.titulo}</div>
                          <p className="mt-1 text-xs opacity-90">{d.descricao}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {s.gancho_abertura && (
                    <div className="rounded-2xl border border-border p-4 text-sm">
                      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> Gancho de abertura</div>
                      <p className="mt-2 italic">"{s.gancho_abertura}"</p>
                    </div>
                  )}
                  {s.proximo_passo && (
                    <div className="rounded-2xl border border-border p-4 text-sm">
                      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1"><TargetIcon className="h-3.5 w-3.5" /> Próximo passo</div>
                      <p className="mt-2">{s.proximo_passo}</p>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ icon: Icon, label, value, full }: { icon?: any; label: string; value?: any; full?: boolean }) {
  return (
    <div className={`rounded-2xl border border-border bg-background p-3 ${full ? "md:col-span-2" : ""}`}>
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />} {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value || "—"}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</div>;
}

function toneFor(sev?: string) {
  if (sev === "alta") return "border-rose-200 bg-rose-50 text-rose-900";
  if (sev === "media") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-border bg-muted/40";
}
function labelStage(s?: string | null) {
  return s === "in_contact" ? "Em contato" : s === "scheduled" ? "Agendou" : s === "dismissed" ? "Dispensou" : "Ativar";
}
function labelMeetingStatus(s?: string | null) {
  return s === "held" ? "Realizada" : s === "no_show" ? "No-Show" : s === "rescheduled" ? "Remarcada" : s === "scheduled" ? "Agendada" : "—";
}
function sociosString(v: any) {
  if (!Array.isArray(v)) return "";
  return v.map((s) => s?.nome || s?.nome_socio).filter(Boolean).join(", ");
}

function ReEnrichButton({ leadId }: { leadId: string }) {
  const qc = useQueryClient();
  const enrich = useServerFn(enrichLeadCnpj);
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      await enrich({ data: { leadId } });
      toast.success("CNPJ re-enriquecido");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao re-enriquecer");
    } finally { setLoading(false); }
  }
  return (
    <Button size="sm" variant="outline" className="rounded-full" onClick={run} disabled={loading}>
      {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
      Re-enriquecer CNPJ
    </Button>
  );
}

const OUTCOME_META: Record<string, { label: string; icon: any; tone: string }> = {
  no_answer:         { label: "Não atendeu",         icon: VoicemailIcon, tone: "border-slate-300 bg-slate-50 text-slate-700" },
  gatekeeper:        { label: "Ponte / Secretária",  icon: PhoneOff,      tone: "border-blue-200 bg-blue-50 text-blue-700" },
  not_interested:    { label: "Sem interesse",       icon: PhoneOff,      tone: "border-rose-200 bg-rose-50 text-rose-700" },
  callback:          { label: "Retornar depois",     icon: CalendarClock, tone: "border-amber-200 bg-amber-50 text-amber-700" },
  meeting_scheduled: { label: "Reunião agendada",    icon: CalendarClock, tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

function timeAgo(iso: string) {
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

function CallHistory({ leadId, lead }: { leadId: string; lead: any }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["lead-call-history", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_logs")
        .select("id, outcome, notes, duration_seconds, nome_ponte, scheduled_return_at, created_at")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const totals = {
    calls: logs.length,
    decisors: logs.filter((l: any) => ["gatekeeper", "meeting_scheduled", "not_interested"].includes(l.outcome)).length,
    followups: logs.filter((l: any) => !!l.scheduled_return_at).length,
  };

  return (
    <div className="space-y-4">
      {lead.followup_at && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
          <div className="text-[10px] font-medium uppercase tracking-widest opacity-80">Follow-up ativo</div>
          <div className="mt-1 font-semibold">
            {new Date(lead.followup_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
            {lead.proprietario ? ` · com ${lead.proprietario}` : ""}
          </div>
          {lead.followup_notes && <p className="mt-1 text-xs opacity-90">{lead.followup_notes}</p>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Tentativas" value={totals.calls} />
        <MiniStat label="Decisores tocados" value={totals.decisors} />
        <MiniStat label="Retornos agendados" value={totals.followups} />
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Carregando histórico…</div>
      ) : logs.length === 0 ? (
        <Empty text="Nenhuma ligação registrada ainda." />
      ) : (
        <ol className="relative ml-3 space-y-3 border-l border-border pl-5">
          {logs.map((l: any) => {
            const meta = OUTCOME_META[l.outcome] ?? { label: l.outcome, icon: PhoneIcon, tone: "border-border bg-muted/40 text-foreground" };
            const Icon = meta.icon;
            const dur = l.duration_seconds ? `${Math.floor(l.duration_seconds / 60)}m${String(l.duration_seconds % 60).padStart(2, "0")}s` : null;
            return (
              <li key={l.id} className="relative">
                <span className={`absolute -left-[27px] top-2 grid h-5 w-5 place-items-center rounded-full border-2 ${meta.tone}`}>
                  <Icon className="h-2.5 w-2.5" />
                </span>
                <div className={`rounded-2xl border p-3 ${meta.tone}`}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold">{meta.label}</span>
                    <span className="text-[11px] opacity-80">
                      {timeAgo(l.created_at)} · {new Date(l.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                  {(l.nome_ponte || dur) && (
                    <div className="mt-1 flex flex-wrap gap-3 text-[11px] opacity-80">
                      {l.nome_ponte && <span>🛎 {l.nome_ponte}</span>}
                      {dur && <span>⏱ {dur}</span>}
                    </div>
                  )}
                  {l.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{l.notes}</p>}
                  {l.scheduled_return_at && (
                    <p className="mt-1 text-xs opacity-80">Retorno combinado: {new Date(l.scheduled_return_at).toLocaleString("pt-BR")}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-3 text-center">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}