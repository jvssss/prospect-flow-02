import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPhoneBR } from "@/lib/goldenMath";
import {
  MapPin, User, Phone, Building2, Calendar, Sparkles, AlertTriangle, ArrowRight,
  MessageSquare, Target as TargetIcon, DollarSign, Users2,
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
          </div>
        </div>

        <div className="px-6 pb-6">
          <Tabs defaultValue="info" className="mt-4">
            <TabsList className="rounded-full">
              <TabsTrigger value="info" className="rounded-full">Visão geral</TabsTrigger>
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