import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveQualification, QualificationSchema, type Qualification } from "@/lib/qualification.functions";

export const Route = createFileRoute("/_authenticated/qualify/$leadId")({
  head: () => ({ meta: [{ title: "Qualificação SDR · Meta Prospect" }] }),
  component: QualifyWizard,
});

type Step = {
  key: keyof Qualification;
  label: string;
  question: string;
  type: "text" | "textarea" | "choice";
  choices?: string[];
  placeholder?: string;
};

const STEPS: Step[] = [
  { key: "matriculas_hoje", label: "Volume de matrículas hoje", question: "Quantas matrículas a autoescola realiza por mês atualmente?", type: "text", placeholder: "Ex.: 30" },
  { key: "matriculas_antes_cnh_brasil", label: "Antes vs. depois da CNH Brasil", question: "Quantas matrículas realizava por mês antes da CNH Brasil?", type: "text", placeholder: "Ex.: 60" },
  { key: "principal_fonte", label: "Principal fonte de matrículas", question: "Qual é a principal fonte de matrículas da autoescola hoje?", type: "text", placeholder: "Indicação, tráfego pago, orgânico…" },
  { key: "investe_marketing", label: "Investe em marketing digital?", question: "Atualmente vocês investem em marketing digital?", type: "choice", choices: ["sim", "nao"] },
  { key: "maior_desafio", label: "Maior desafio", question: "Qual é o maior desafio da autoescola hoje?", type: "textarea", placeholder: "Descreva o principal desafio…" },
  { key: "responsavel", label: "Responsável pela empresa", question: "Quem é o responsável pela empresa?", type: "text", placeholder: "Nome do decisor" },
  { key: "nome_autoescola", label: "Nome da autoescola", question: "Qual o nome da autoescola?", type: "text" },
  { key: "cidade", label: "Cidade", question: "Em qual cidade a autoescola está localizada?", type: "text" },
  { key: "socios", label: "Sócios", question: "Tem sócio? Se sim, quais os nomes? (deixe em branco se não)", type: "textarea", placeholder: "Nomes separados por vírgula" },
];

function QualifyWizard() {
  const { leadId } = Route.useParams();
  const navigate = useNavigate();
  const save = useServerFn(saveQualification);

  const { data: lead } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Partial<Qualification>>({});
  const [meetingAt, setMeetingAt] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setValues((v) => ({
      nome_autoescola: lead.nome_fantasia ?? lead.razao_social ?? "",
      cidade: lead.cidade ?? "",
      responsavel: lead.proprietario ?? "",
      socios: Array.isArray(lead.socios) ? (lead.socios as any[]).map((s) => s?.nome || s?.nome_socio).filter(Boolean).join(", ") : "",
      ...(lead.sdr_qualification as any ?? {}),
      ...v,
    }));
    if (lead.meeting_at) setMeetingAt(new Date(lead.meeting_at).toISOString().slice(0, 16));
    if (lead.meeting_link) setMeetingLink(lead.meeting_link);
  }, [lead]);

  const total = STEPS.length + 1; // +1 for handoff
  const isHandoff = step === STEPS.length;
  const current = STEPS[step];
  const currentValue = current ? (values[current.key] ?? "") : "";

  const canNext = useMemo(() => {
    if (isHandoff) return true;
    if (current.key === "socios") return true; // optional
    return String(currentValue).trim().length > 0;
  }, [current, currentValue, isHandoff]);

  function next() {
    if (!canNext) return;
    if (step < total - 1) setStep(step + 1);
  }
  function back() { if (step > 0) setStep(step - 1); }

  async function finish() {
    try {
      const parsed = QualificationSchema.parse({ ...values, socios: values.socios ?? "" });
      setSaving(true);
      await save({
        data: {
          leadId,
          qualification: parsed,
          meeting_at: meetingAt ? new Date(meetingAt).toISOString() : null,
          meeting_link: meetingLink,
        },
      });
      toast.success("Qualificação salva. Lead enviado ao Closer.");
      navigate({ to: "/closer/$leadId", params: { leadId } });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao salvar");
    } finally { setSaving(false); }
  }

  const pct = Math.round(((step + 1) / total) * 100);

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-3xl flex-col px-6 py-8">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="text-primary">{isHandoff ? "Agendamento" : current.label}</span>
        <span className="tabular-nums">{step + 1} / {total}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-14 flex-1">
        {!isHandoff ? (
          <>
            <div className="mb-2 flex items-center gap-2 text-primary"><span className="text-sm">{step + 1}</span><ArrowRight className="h-4 w-4" /></div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">{current.question}</h1>
            <div className="mt-10 max-w-xl">
              {current.type === "choice" ? (
                <div className="grid grid-cols-2 gap-3">
                  {current.choices!.map((c) => {
                    const active = currentValue === c;
                    return (
                      <button key={c} type="button"
                        onClick={() => { setValues({ ...values, [current.key]: c }); setTimeout(next, 120); }}
                        className={`rounded-2xl border-2 py-6 text-xl font-semibold transition ${active ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"}`}>
                        {c === "sim" ? "Sim" : "Não"}
                      </button>
                    );
                  })}
                </div>
              ) : current.type === "textarea" ? (
                <Textarea autoFocus value={String(currentValue)} placeholder={current.placeholder}
                  onChange={(e) => setValues({ ...values, [current.key]: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) next(); }}
                  className="min-h-32 rounded-2xl text-lg" />
              ) : (
                <Input autoFocus value={String(currentValue)} placeholder={current.placeholder}
                  onChange={(e) => setValues({ ...values, [current.key]: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") next(); }}
                  className="h-14 rounded-2xl text-lg" />
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold tracking-tight">Agendamento da reunião</h1>
            <p className="mt-1 text-muted-foreground">Passe o lead ao Closer com data, horário e link.</p>
            <div className="mt-8 grid max-w-xl gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Data e hora</label>
                <Input type="datetime-local" value={meetingAt} onChange={(e) => setMeetingAt(e.target.value)} className="h-12 rounded-2xl" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Link da reunião</label>
                <Input value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://meet.google.com/…" className="h-12 rounded-2xl" />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-10 flex items-center gap-4">
        {!isHandoff ? (
          <Button onClick={next} disabled={!canNext} className="h-12 rounded-2xl px-6">OK <ArrowRight className="ml-2 h-4 w-4" /></Button>
        ) : (
          <Button onClick={finish} disabled={saving} className="h-12 rounded-2xl px-6">
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando resumo IA…</> : <>Salvar e enviar ao Closer <ArrowRight className="ml-2 h-4 w-4" /></>}
          </Button>
        )}
        {step > 0 && (
          <button type="button" onClick={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
        )}
        {!isHandoff && <span className="text-xs text-muted-foreground">pressione Enter ⏎</span>}
      </div>
    </div>
  );
}