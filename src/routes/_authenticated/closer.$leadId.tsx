import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, AlertTriangle, MapPin, User, Building2, Calendar, Clock, MessageSquare,
  TrendingDown, Target, Users2, DollarSign, ArrowLeft, Loader2, Trash2, RefreshCw, Check, X,
} from "lucide-react";
import { toast } from "sonner";
import { regenerateCloserSummary, updateMeeting } from "@/lib/qualification.functions";

export const Route = createFileRoute("/_authenticated/closer/$leadId")({
  head: () => ({ meta: [{ title: "Closer · Meta Prospect" }] }),
  component: CloserView,
});

function CloserView() {
  const { leadId } = Route.useParams();
  const qc = useQueryClient();
  const regen = useServerFn(regenerateCloserSummary);
  const upd = useServerFn(updateMeeting);

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [notes, setNotes] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);

  useEffect(() => { if (lead?.closer_notes) setNotes(lead.closer_notes); }, [lead?.id]);

  if (isLoading || !lead) return <div className="p-8 text-muted-foreground">Carregando…</div>;

  const q: any = lead.sdr_qualification ?? {};
  const s: any = lead.closer_summary ?? {};
  const dores: any[] = Array.isArray(s.dores) ? s.dores : [];

  async function doRegen() {
    setRegenLoading(true);
    try {
      await regen({ data: { leadId } });
      await qc.invalidateQueries({ queryKey: ["lead", leadId] });
      toast.success("Resumo regenerado");
    } catch (e: any) { toast.error(e?.message ?? "Falha ao regenerar"); }
    finally { setRegenLoading(false); }
  }

  async function setStatus(meeting_status: any) {
    await upd({ data: { leadId, meeting_status } });
    qc.invalidateQueries({ queryKey: ["lead", leadId] });
    toast.success("Status atualizado");
  }
  async function setResult(meeting_result: "won" | "lost") {
    await upd({ data: { leadId, meeting_result, meeting_status: "held" } });
    qc.invalidateQueries({ queryKey: ["lead", leadId] });
    toast.success(meeting_result === "won" ? "Ganho registrado 🎉" : "Perda registrada");
  }
  async function saveNotes() {
    await upd({ data: { leadId, closer_notes: notes } });
    toast.success("Anotações salvas");
  }

  const meetingDate = lead.meeting_at ? new Date(lead.meeting_at) : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link to="/sdr" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar ao CRM SDR
      </Link>

      <Card className="rounded-3xl border-border shadow-[var(--shadow-soft)]">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-widest text-primary">Autoescola</div>
              <h1 className="mt-1 text-3xl font-bold tracking-tight">{lead.nome_fantasia ?? lead.razao_social ?? "Lead"}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {lead.cidade && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {lead.cidade}</span>}
                <Badge variant="secondary" className="rounded-full">Status: {lead.status}</Badge>
                {lead.proprietario && <span className="inline-flex items-center gap-1"><User className="h-4 w-4" /> {lead.proprietario}</span>}
              </div>
            </div>
            <Button variant="outline" className="rounded-2xl"><Trash2 className="mr-2 h-4 w-4" /> Remover</Button>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="rounded-3xl border-border shadow-[var(--shadow-soft)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="h-5 w-5 text-primary" /> Resumo do Closer</div>
                <Button size="sm" onClick={doRegen} disabled={regenLoading} className="rounded-2xl">
                  {regenLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RefreshCw className="mr-2 h-4 w-4" /> Regenerar</>}
                </Button>
              </div>

              {!s.resumo ? (
                <div className="mt-4 rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                  Nenhum resumo ainda. Faça a qualificação do SDR para gerar o resumo com IA.
                </div>
              ) : (
                <>
                  <p className="mt-4 text-base font-medium leading-relaxed">{s.resumo}</p>

                  {dores.length > 0 && (
                    <>
                      <div className="mt-6 text-xs font-medium uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" /> Principais dores
                      </div>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        {dores.map((d, i) => (
                          <div key={i} className={`rounded-2xl border p-4 ${toneFor(d.severidade)}`}>
                            <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> {d.titulo}</div>
                            <p className="mt-1 text-sm opacity-90">{d.descricao}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="mt-6 grid gap-6 md:grid-cols-2">
                    {s.gancho_abertura && (
                      <div>
                        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1">💬 Gancho de abertura</div>
                        <p className="mt-2 italic">"{s.gancho_abertura}"</p>
                      </div>
                    )}
                    {s.proximo_passo && (
                      <div>
                        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1"><Target className="h-3.5 w-3.5" /> Próximo passo</div>
                        <p className="mt-2">{s.proximo_passo}</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-border shadow-[var(--shadow-soft)]">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-lg font-semibold"><MessageSquare className="h-5 w-5 text-primary" /> Qualificação SDR</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field icon={TrendingDown} label="Volume de matrículas hoje" value={q.matriculas_hoje} />
                <Field icon={TrendingDown} label="Antes vs. depois da CNH Brasil" value={q.matriculas_antes_cnh_brasil} />
                <Field icon={Target} label="Investe em captação online?" value={q.investe_marketing === "sim" ? "Sim" : q.investe_marketing === "nao" ? "Não" : undefined} />
                <Field icon={Target} label="Principal fonte de matrículas" value={q.principal_fonte} />
                <Field icon={AlertTriangle} label="Maior desafio" value={q.maior_desafio} />
                <Field icon={User} label="Responsável" value={q.responsavel} />
              </div>

              <div className="mt-6 flex items-center gap-2 text-lg font-semibold"><Building2 className="h-5 w-5 text-primary" /> Dados da autoescola</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field icon={MapPin} label="Cidade" value={q.cidade ?? lead.cidade} />
                <Field icon={Users2} label="Sócios" value={q.socios || sociosString(lead.socios)} />
                <Field icon={DollarSign} label="Capital social" value={lead.capital_social ? `R$ ${Number(lead.capital_social).toLocaleString("pt-BR")}` : undefined} />
                <Field icon={Calendar} label="Abertura" value={lead.data_abertura ?? undefined} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="rounded-3xl border-border shadow-[var(--shadow-soft)]">
            <CardContent className="p-6">
              <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Reunião</div>
              <div className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight text-primary">
                <Calendar className="h-5 w-5" />
                {meetingDate ? meetingDate.toLocaleDateString("pt-BR") : "—"}
              </div>
              <div className="mt-1 flex items-center gap-2 text-lg font-semibold">
                <Clock className="h-4 w-4 text-muted-foreground" />
                {meetingDate ? meetingDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
              </div>
              <div className="mt-2 text-sm">Status atual: <span className="font-medium">{labelStatus(lead.meeting_status)}</span></div>
              {lead.meeting_link && (
                <a href={lead.meeting_link} target="_blank" rel="noreferrer" className="mt-2 block truncate text-sm text-primary hover:underline">{lead.meeting_link}</a>
              )}

              <div className="mt-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">Marcar resultado</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setStatus("held")}>Realizada</Button>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setStatus("no_show")}>No-Show</Button>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setStatus("rescheduled")}>Remarcada</Button>
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" className="rounded-full border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => setResult("won")}>
                  <Check className="mr-1 h-4 w-4" /> Ganho
                </Button>
                <Button size="sm" variant="outline" className="rounded-full border-rose-300 text-rose-700 hover:bg-rose-50" onClick={() => setResult("lost")}>
                  <X className="mr-1 h-4 w-4" /> Perdido
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-border shadow-[var(--shadow-soft)]">
            <CardContent className="p-6">
              <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Anotações da call</div>
              <Textarea className="mt-2 min-h-40 rounded-2xl" placeholder="Anote objeções, decisor, próximos passos…"
                value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, value }: any) {
  return (
    <div className="rounded-2xl border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 font-medium">{value || "—"}</div>
    </div>
  );
}

function toneFor(sev?: string) {
  if (sev === "alta") return "border-rose-200 bg-rose-50 text-rose-900";
  if (sev === "media") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-border bg-muted/40";
}

function labelStatus(s?: string | null) {
  return s === "held" ? "Realizada" : s === "no_show" ? "No-Show" : s === "rescheduled" ? "Remarcada" : s === "scheduled" ? "Agendada" : "—";
}

function sociosString(v: any) {
  if (!Array.isArray(v)) return "";
  return v.map((s) => s?.nome || s?.nome_socio).filter(Boolean).join(", ");
}