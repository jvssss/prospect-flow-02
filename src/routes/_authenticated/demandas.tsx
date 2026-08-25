import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, ClipboardCopy, CalendarClock, PhoneCall, Clock, Trophy, Sparkles } from "lucide-react";
import { formatPhoneBR, formatSeconds } from "@/lib/goldenMath";

export const Route = createFileRoute("/_authenticated/demandas")({
  head: () => ({
    meta: [
      { title: "Demandas de Hoje · Meta Prospect" },
      { name: "description", content: "Relatório dos leads trabalhados no Modo Foco, com exportação em CSV." },
    ],
  }),
  component: DemandasPage,
});

// Desfechos gravados pelo Modo Foco (espelha OUTCOMES em cockpit.tsx).
const OUTCOME_META: Record<string, { label: string; weight: number }> = {
  meeting_scheduled: { label: "Reunião agendada", weight: 5 },
  callback: { label: "Retornar depois", weight: 3 },
  gatekeeper: { label: "Ponte / Secretária", weight: 2 },
  not_interested: { label: "Sem interesse", weight: 1 },
  no_answer: { label: "Não atendeu", weight: 0 },
};

const outcomeLabel = (o: string) => OUTCOME_META[o]?.label ?? o;
const outcomeWeight = (o: string) => OUTCOME_META[o]?.weight ?? 0;

// --- datas -----------------------------------------------------------------
// Atenção: call_logs.created_at é timestamptz (UTC). O recorte do dia precisa
// usar a meia-noite LOCAL, senão toda ligação feita depois das 21h (BRT) cai
// no dia seguinte no relatório.
function localDayISO(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayBounds(dayISO: string) {
  const start = new Date(`${dayISO}T00:00:00`); // sem "Z": interpretado como local
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { fromISO: start.toISOString(), toISO: end.toISOString() };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtDayLabel(dayISO: string) {
  const d = new Date(`${dayISO}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dayISO;
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}

// --- notas -----------------------------------------------------------------
// O cockpit grava notes como "Decisor: Fulano · texto livre" (cockpit.tsx).
function parseNotes(notes: string | null | undefined) {
  if (!notes) return { decisor: null as string | null, texto: null as string | null };
  let decisor: string | null = null;
  const rest: string[] = [];
  for (const part of notes.split(" · ")) {
    const m = part.match(/^Decisor:\s*(.+)$/);
    if (m) decisor = m[1].trim();
    else if (part.trim()) rest.push(part.trim());
  }
  return { decisor, texto: rest.join(" · ") || null };
}

type CallRow = {
  id: string;
  lead_id: string | null;
  user_id: string;
  outcome: string;
  notes: string | null;
  nome_ponte: string | null;
  scheduled_return_at: string | null;
  duration_seconds: number | null;
  created_at: string;
};

type LeadRow = Database["public"]["Tables"]["leads"]["Row"];

type Demanda = {
  leadId: string;
  lead: LeadRow | null;
  empresa: string;
  calls: CallRow[];
  lastCall: CallRow;
  bestOutcome: string;
  totalSeconds: number;
  info: number;
  bits: string[];
  ponte: string | null;
  decisor: string | null;
  obs: string | null;
  retorno: string | null;
};

function buildDemanda(leadId: string, calls: CallRow[], lead: LeadRow | null): Demanda {
  const ordered = [...calls].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  const parsed = ordered.map((c) => parseNotes(c.notes));

  const ponte = ordered.find((c) => c.nome_ponte)?.nome_ponte ?? lead?.nome_ponte ?? null;
  const decisor = parsed.find((p) => p.decisor)?.decisor ?? lead?.proprietario ?? null;
  const obs = parsed.map((p) => p.texto).filter(Boolean).join(" · ") || null;
  const retorno = ordered.find((c) => c.scheduled_return_at)?.scheduled_return_at ?? lead?.retorno_agendado_em ?? null;

  // "Mais informações adicionadas" = quantos campos de captura foram preenchidos.
  const bits: string[] = [];
  let info = 0;
  if (ponte) { info += 2; bits.push("Ponte"); }
  if (decisor) { info += 2; bits.push("Decisor"); }
  if (obs) { info += 2; bits.push("Observações"); }
  if (retorno) { info += 2; bits.push("Retorno"); }
  if (lead?.meeting_at) { info += 2; bits.push("Reunião"); }
  if (lead?.followup_at) { info += 1; bits.push("Follow-up"); }
  if (lead?.followup_notes) { info += 1; bits.push("Notas follow-up"); }

  const bestOutcome = ordered.reduce(
    (best, c) => (outcomeWeight(c.outcome) > outcomeWeight(best) ? c.outcome : best),
    ordered[0].outcome,
  );

  return {
    leadId,
    lead,
    empresa: lead?.nome_fantasia ?? lead?.razao_social ?? "Lead removido",
    calls: ordered,
    lastCall: ordered[0],
    bestOutcome,
    totalSeconds: ordered.reduce((s, c) => s + (c.duration_seconds ?? 0), 0),
    info,
    bits,
    ponte,
    decisor,
    obs,
    retorno,
  };
}

// --- CSV -------------------------------------------------------------------
// Separador ";" e BOM UTF-8: sem isso o Excel em pt-BR joga tudo numa coluna
// só e estraga os acentos.
const CSV_SEP = ";";

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  s = s.replace(/\r?\n|\r/g, " ").trim();
  // Neutraliza injeção de fórmula: um lead chamado "=CMD(...)" vira fórmula no Excel.
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS: { header: string; value: (d: Demanda) => unknown }[] = [
  { header: "Empresa", value: (d) => d.empresa },
  { header: "Razão Social", value: (d) => d.lead?.razao_social },
  { header: "CNPJ", value: (d) => d.lead?.cnpj },
  { header: "Telefone 1", value: (d) => formatPhoneBR(d.lead?.telefone_1) },
  { header: "Telefone 2", value: (d) => formatPhoneBR(d.lead?.telefone_2) },
  { header: "WhatsApp", value: (d) => formatPhoneBR(d.lead?.whatsapp) },
  { header: "Bairro", value: (d) => d.lead?.bairro },
  { header: "Cidade", value: (d) => d.lead?.cidade },
  { header: "UF", value: (d) => d.lead?.uf },
  { header: "Desfecho", value: (d) => outcomeLabel(d.bestOutcome) },
  { header: "Ligações no dia", value: (d) => d.calls.length },
  { header: "Nome da Ponte", value: (d) => d.ponte },
  { header: "Decisor", value: (d) => d.decisor },
  { header: "Observações", value: (d) => d.obs },
  { header: "Retorno Agendado", value: (d) => fmtDateTime(d.retorno) },
  { header: "Reunião em", value: (d) => fmtDateTime(d.lead?.meeting_at) },
  { header: "Follow-up em", value: (d) => fmtDateTime(d.lead?.followup_at) },
  { header: "Notas de Follow-up", value: (d) => d.lead?.followup_notes },
  { header: "Tempo em ligação", value: (d) => formatSeconds(d.totalSeconds) },
  { header: "Última ligação", value: (d) => fmtTime(d.lastCall.created_at) },
  { header: "Status", value: (d) => d.lead?.status },
  { header: "Etapa", value: (d) => d.lead?.pipeline_stage },
  { header: "Info capturada", value: (d) => d.info },
];

function buildCsv(rows: Demanda[]) {
  const head = CSV_COLUMNS.map((c) => csvCell(c.header)).join(CSV_SEP);
  const body = rows.map((d) => CSV_COLUMNS.map((c) => csvCell(c.value(d))).join(CSV_SEP));
  return [head, ...body].join("\r\n");
}

// BOM UTF-8: sem ele o Excel em pt-BR lê os acentos errado.
const BOM = String.fromCharCode(0xfeff);

function downloadCsv(rows: Demanda[], dayISO: string) {
  const blob = new Blob([BOM + buildCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `demandas-${dayISO}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --- página ----------------------------------------------------------------
function DemandasPage() {
  const [day, setDay] = useState(localDayISO());
  const [scope, setScope] = useState<"me" | "team">("me");
  const [sort, setSort] = useState<"info" | "recent" | "outcome">("info");

  const { data: me } = useQuery({
    queryKey: ["auth-user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: 5 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["demandas", day, scope, me?.id],
    enabled: !!me,
    queryFn: async () => {
      const { fromISO, toISO } = dayBounds(day);
      // As policies desta base são USING(true) para authenticated, ou seja,
      // sem este filtro viriam as ligações de todos os usuários.
      let q = supabase
        .from("call_logs")
        .select("id, lead_id, user_id, outcome, notes, nome_ponte, scheduled_return_at, duration_seconds, created_at")
        .gte("created_at", fromISO)
        .lt("created_at", toISO)
        .order("created_at", { ascending: false });
      if (scope === "me" && me) q = q.eq("user_id", me.id);

      const { data: calls, error } = await q;
      if (error) throw error;

      const rows = (calls ?? []) as CallRow[];
      const leadIds = [...new Set(rows.map((c) => c.lead_id).filter((x): x is string => !!x))];
      let leads: LeadRow[] = [];
      if (leadIds.length) {
        const { data: ld, error: lErr } = await supabase.from("leads").select("*").in("id", leadIds);
        if (lErr) throw lErr;
        leads = ld ?? [];
      }
      return { calls: rows, leads };
    },
  });

  const demandas = useMemo(() => {
    if (!data) return [] as Demanda[];
    const leadById = new Map(data.leads.map((l) => [String(l.id), l]));
    const byLead = new Map<string, CallRow[]>();
    for (const c of data.calls) {
      if (!c.lead_id) continue;
      const arr = byLead.get(c.lead_id);
      if (arr) arr.push(c);
      else byLead.set(c.lead_id, [c]);
    }
    const list = [...byLead.entries()].map(([leadId, calls]) =>
      buildDemanda(leadId, calls, leadById.get(leadId) ?? null),
    );

    const recency = (d: Demanda) => +new Date(d.lastCall.created_at);
    list.sort((a, b) => {
      if (sort === "recent") return recency(b) - recency(a);
      if (sort === "outcome") {
        const diff = outcomeWeight(b.bestOutcome) - outcomeWeight(a.bestOutcome);
        return diff !== 0 ? diff : recency(b) - recency(a);
      }
      // "info": mais informações adicionadas primeiro; desfecho desempata.
      if (b.info !== a.info) return b.info - a.info;
      const diff = outcomeWeight(b.bestOutcome) - outcomeWeight(a.bestOutcome);
      return diff !== 0 ? diff : recency(b) - recency(a);
    });
    return list;
  }, [data, sort]);

  const resumo = useMemo(() => {
    const totalCalls = demandas.reduce((s, d) => s + d.calls.length, 0);
    const seconds = demandas.reduce((s, d) => s + d.totalSeconds, 0);
    const porDesfecho = new Map<string, number>();
    for (const d of demandas) porDesfecho.set(d.bestOutcome, (porDesfecho.get(d.bestOutcome) ?? 0) + 1);
    return {
      leads: demandas.length,
      totalCalls,
      seconds,
      comInfo: demandas.filter((d) => d.info > 0).length,
      reunioes: demandas.filter((d) => d.bestOutcome === "meeting_scheduled").length,
      porDesfecho: [...porDesfecho.entries()].sort((a, b) => outcomeWeight(b[0]) - outcomeWeight(a[0])),
    };
  }, [demandas]);

  function relatorioTexto() {
    const linhas = [
      `RELATÓRIO DE PROSPECÇÃO — ${fmtDayLabel(day)}`,
      "",
      `Leads trabalhados: ${resumo.leads}`,
      `Ligações registradas: ${resumo.totalCalls}`,
      `Tempo em ligação: ${formatSeconds(resumo.seconds)}`,
      `Leads com informação nova: ${resumo.comInfo}`,
      `Reuniões agendadas: ${resumo.reunioes}`,
      "",
      "Por desfecho:",
      ...resumo.porDesfecho.map(([o, n]) => `  · ${outcomeLabel(o)}: ${n}`),
    ];
    const destaques = demandas.filter((d) => d.info > 0).slice(0, 10);
    if (destaques.length) {
      linhas.push("", "Destaques (mais informação capturada):");
      for (const d of destaques) {
        const extra = [
          d.decisor ? `decisor ${d.decisor}` : null,
          d.ponte ? `ponte ${d.ponte}` : null,
          d.retorno ? `retorno ${fmtDateTime(d.retorno)}` : null,
        ].filter(Boolean).join(", ");
        linhas.push(`  · ${d.empresa} — ${outcomeLabel(d.bestOutcome)}${extra ? ` (${extra})` : ""}`);
      }
    }
    return linhas.join("\n");
  }

  async function copiarRelatorio() {
    try {
      await navigator.clipboard.writeText(relatorioTexto());
      toast.success("Relatório copiado");
    } catch {
      toast.error("Não consegui copiar. Verifique a permissão do navegador.");
    }
  }

  function exportar() {
    if (!demandas.length) return toast.error("Nada para exportar neste dia");
    downloadCsv(demandas, day);
    toast.success(`${demandas.length} leads exportados`);
  }

  const isToday = day === localDayISO();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Execução</div>
          <h1 className="mt-1 text-4xl tracking-tight md:text-5xl">Demandas de Hoje</h1>
          <p className="mt-1 text-muted-foreground">
            {isToday ? "Hoje" : fmtDayLabel(day)} · {resumo.leads} leads trabalhados no Modo Foco
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-2xl" onClick={copiarRelatorio} disabled={!demandas.length}>
            <ClipboardCopy className="mr-2 h-4 w-4" /> Copiar relatório
          </Button>
          <Button className="rounded-2xl" onClick={exportar} disabled={!demandas.length}>
            <Download className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Sparkles} label="Leads trabalhados" value={String(resumo.leads)} />
        <StatCard icon={PhoneCall} label="Ligações" value={String(resumo.totalCalls)} />
        <StatCard icon={Clock} label="Tempo em ligação" value={formatSeconds(resumo.seconds)} />
        <StatCard icon={Trophy} label="Reuniões agendadas" value={String(resumo.reunioes)} />
      </div>

      <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              type="date"
              className="w-44 rounded-xl"
              value={day}
              max={localDayISO()}
              onChange={(e) => setDay(e.target.value || localDayISO())}
            />
            {!isToday && (
              <Button size="sm" variant="ghost" className="h-9 rounded-lg" onClick={() => setDay(localDayISO())}>
                Voltar para hoje
              </Button>
            )}
            <Select value={scope} onValueChange={(v) => setScope(v as "me" | "team")}>
              <SelectTrigger className="w-40 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="me">Só eu</SelectItem>
                <SelectItem value="team">Equipe toda</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="w-52 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Mais informações primeiro</SelectItem>
                <SelectItem value="outcome">Por desfecho</SelectItem>
                <SelectItem value="recent">Mais recentes</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto text-xs text-muted-foreground">
              {resumo.comInfo} de {resumo.leads} com informação nova
            </div>
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : demandas.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-sm font-medium">Nenhum lead trabalhado {isToday ? "hoje" : "neste dia"}.</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Cada desfecho registrado no Modo Foco aparece aqui.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Desfecho</TableHead>
                    <TableHead>Informação capturada</TableHead>
                    <TableHead>Retorno</TableHead>
                    <TableHead className="text-right">Ligações</TableHead>
                    <TableHead className="text-right">Última</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {demandas.map((d) => (
                    <TableRow key={d.leadId}>
                      <TableCell>
                        <div className="font-medium">{d.empresa}</div>
                        {d.lead?.bairro && (
                          <div className="text-xs text-muted-foreground">
                            {d.lead.bairro}{d.lead?.cidade ? ` · ${d.lead.cidade}` : ""}
                          </div>
                        )}
                        {d.decisor && <div className="text-xs text-muted-foreground">Decisor: {d.decisor}</div>}
                        {d.ponte && <div className="text-xs text-muted-foreground">Ponte: {d.ponte}</div>}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatPhoneBR(d.lead?.telefone_1) || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="rounded-full">{outcomeLabel(d.bestOutcome)}</Badge>
                      </TableCell>
                      <TableCell>
                        {d.bits.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {d.bits.map((b) => (
                              <Badge key={b} variant="outline" className="rounded-full text-[10px]">{b}</Badge>
                            ))}
                          </div>
                        )}
                        {d.obs && <div className="mt-1 max-w-xs truncate text-xs text-muted-foreground">{d.obs}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        {d.retorno ? (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" /> {fmtDateTime(d.retorno)}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{d.calls.length}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTime(d.lastCall.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[color:var(--primary-glow)] text-primary-foreground shadow-[var(--shadow-elegant)]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
