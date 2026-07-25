import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Search, Plus, Trash2, Loader2, Radar, Users2, Sparkles } from "lucide-react";
import { formatBRL, formatPhoneBR, onlyDigits } from "@/lib/goldenMath";
import { enrichMissingSocios, startEnrichmentJob, syncEnrichmentJob } from "@/lib/enrichment.functions";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "Leads · Meta Prospect" },
      { name: "description", content: "Importe, filtre e gerencie sua base de leads." },
    ],
  }),
  component: LeadsPage,
});

const STATUSES = [
  { v: "all", label: "Todos" },
  { v: "new", label: "Novos" },
  { v: "no_answer", label: "Não atendeu" },
  { v: "gatekeeper", label: "Ponte" },
  { v: "callback", label: "Retornar" },
  { v: "meeting_scheduled", label: "Reunião" },
  { v: "not_interested", label: "Sem interesse" },
];

function LeadsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [hasCnpj, setHasCnpj] = useState("all");
  const [hasReviews, setHasReviews] = useState("all");
  const [sort, setSort] = useState("recent");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: leads = [] } = useQuery({
    queryKey: ["leads", status],
    queryFn: async () => {
      let query = supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(500);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const cityOptions = useMemo(() => {
    const map = new Map<string, number>();
    leads.forEach((l: any) => {
      const c = (l.cidade ?? "").trim();
      if (c) map.set(c, (map.get(c) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [leads]);

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l: any) => { if (l.source) set.add(l.source); });
    return Array.from(set).sort();
  }, [leads]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    let out = leads.filter((l: any) => {
      if (cityFilter !== "all" && (l.cidade ?? "").trim() !== cityFilter) return false;
      if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
      if (hasCnpj === "yes" && !l.cnpj) return false;
      if (hasCnpj === "no" && l.cnpj) return false;
      if (hasReviews === "yes" && l.google_reviews == null) return false;
      if (hasReviews === "no" && l.google_reviews != null) return false;
      if (t && ![l.nome_fantasia, l.razao_social, l.bairro, l.cidade, l.telefone_1, l.telefone_2, l.cnpj]
        .filter(Boolean).some((s) => String(s).toLowerCase().includes(t))) return false;
      return true;
    });
    if (sort === "reviews") {
      out = [...out].sort((a: any, b: any) => (b.google_reviews ?? -1) - (a.google_reviews ?? -1));
    } else if (sort === "capital") {
      out = [...out].sort((a: any, b: any) => Number(b.capital_social ?? 0) - Number(a.capital_social ?? 0));
    } else if (sort === "city") {
      out = [...out].sort((a: any, b: any) => (a.cidade ?? "").localeCompare(b.cidade ?? ""));
    }
    return out;
  }, [leads, q, cityFilter, sourceFilter, hasCnpj, hasReviews, sort]);

  function clearFilters() {
    setQ(""); setStatus("all"); setCityFilter("all"); setSourceFilter("all");
    setHasCnpj("all"); setHasReviews("all"); setSort("recent");
  }
  const activeFilters =
    (status !== "all" ? 1 : 0) + (cityFilter !== "all" ? 1 : 0) + (sourceFilter !== "all" ? 1 : 0) +
    (hasCnpj !== "all" ? 1 : 0) + (hasReviews !== "all" ? 1 : 0);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });

  async function handleFile(file: File) {
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) return toast.error("CSV vazio");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const inserts = rows.map((r) => mapRow(r, u.user!.id));
    const { error, count } = await supabase.from("leads").insert(inserts, { count: "exact" });
    if (error) return toast.error(error.message);
    toast.success(`${count ?? inserts.length} leads importados`);
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["cockpit-queue"] });
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Base</div>
          <h1 className="mt-1 text-4xl tracking-tight md:text-5xl">Leads</h1>
          <p className="mt-1 text-muted-foreground">{leads.length} leads · fila do Modo Foco</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LeadFetchButton onDone={() => qc.invalidateQueries({ queryKey: ["leads"] })} />
          <Button variant="outline" className="rounded-2xl" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Importar CSV
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          <NewLeadDialog onCreated={() => qc.invalidateQueries({ queryKey: ["leads"] })} />
        </div>
      </div>

      <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="rounded-xl pl-9" placeholder="Buscar por nome, telefone, cidade..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select value={cityFilter} onValueChange={setCityFilter}>
              <SelectTrigger className="w-52 rounded-xl"><SelectValue placeholder="Cidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as cidades</SelectItem>
                {cityOptions.map(([name, n]) => <SelectItem key={name} value={name}>{name} · {n}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-40 rounded-xl"><SelectValue placeholder="Origem" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas origens</SelectItem>
                {sourceOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={hasCnpj} onValueChange={setHasCnpj}>
              <SelectTrigger className="w-40 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">CNPJ: todos</SelectItem>
                <SelectItem value="yes">Com CNPJ</SelectItem>
                <SelectItem value="no">Sem CNPJ</SelectItem>
              </SelectContent>
            </Select>
            <Select value={hasReviews} onValueChange={setHasReviews}>
              <SelectTrigger className="w-44 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Google: todos</SelectItem>
                <SelectItem value="yes">Com avaliações</SelectItem>
                <SelectItem value="no">Sem avaliações</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-44 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Mais recentes</SelectItem>
                <SelectItem value="reviews">Mais avaliações</SelectItem>
                <SelectItem value="capital">Maior capital</SelectItem>
                <SelectItem value="city">Cidade (A-Z)</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span>{filtered.length} de {leads.length}</span>
              {activeFilters > 0 && (
                <Button size="sm" variant="ghost" className="h-7 rounded-lg" onClick={clearFilters}>Limpar filtros</Button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Capital</TableHead>
                  <TableHead>Reviews</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="font-medium">{l.nome_fantasia ?? l.razao_social ?? "—"}</div>
                      {l.razao_social && l.nome_fantasia && <div className="text-xs text-muted-foreground">{l.razao_social}</div>}
                      {l.cnpj && <div className="text-xs text-muted-foreground tabular-nums">CNPJ {l.cnpj}</div>}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatPhoneBR(l.telefone_1) || "—"}</TableCell>
                    <TableCell>{l.cidade ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{l.capital_social ? formatBRL(Number(l.capital_social)) : "—"}</TableCell>
                    <TableCell className="tabular-nums">{l.google_reviews ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary" className="rounded-full">{l.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => del.mutate(l.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Nenhum lead encontrado.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LeadFetchButton({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState("");
  const [niche, setNiche] = useState("Autoescola");
  const [maxResults, setMaxResults] = useState(40);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"idle" | "maps" | "cnpj" | "backfill" | "done">("idle");
  const [created, setCreated] = useState<number | null>(null);
  const [rejectedCategory, setRejectedCategory] = useState<number>(0);
  const [batchNum, setBatchNum] = useState(0);
  const [backfillResult, setBackfillResult] = useState<{
    ok: number; matched: number;
    matched_by_name?: number; matched_by_phone?: number;
    matched_by_cep?: number; matched_by_district?: number; matched_by_serp?: number;
    not_found?: number; exhausted?: boolean;
    processed?: number; remaining?: number; initialRemaining?: number;
  } | null>(null);
  const cancelRef = useRef(false);

  const start = useServerFn(startEnrichmentJob);
  const sync = useServerFn(syncEnrichmentJob);
  const backfill = useServerFn(enrichMissingSocios);

  const { data: stats } = useQuery({
    queryKey: ["leads-backfill-stats"],
    queryFn: async () => {
      const [noSocios, noCnpj] = await Promise.all([
        supabase.from("leads").select("*", { count: "exact", head: true }).is("socios", null),
        supabase.from("leads").select("*", { count: "exact", head: true }).is("cnpj", null),
      ]);
      return { noSocios: noSocios.count ?? 0, noCnpj: noCnpj.count ?? 0 };
    },
    enabled: open,
    staleTime: 30_000,
  });

  function reset() {
    setJobId(null); setStatus(""); setProgress(0); setPhase("idle");
    setCreated(null); setBackfillResult(null); setBatchNum(0); setRejectedCategory(0);
    cancelRef.current = false;
  }

  async function runBackfillPhase() {
    setPhase("backfill");
    const acc = {
      ok: 0, matched: 0,
      matched_by_name: 0, matched_by_phone: 0,
      matched_by_cep: 0, matched_by_district: 0, matched_by_serp: 0,
      not_found: 0, exhausted: false,
      processed: 0, remaining: 0, initialRemaining: 0,
    };
    try {
      for (let i = 0; i < 20; i++) {
        if (cancelRef.current) break;
        setBatchNum(i + 1);
        const r: any = await backfill();
        acc.ok += r?.ok ?? 0;
        acc.matched += r?.matched ?? 0;
        acc.matched_by_name += r?.matched_by_name ?? 0;
        acc.matched_by_phone += r?.matched_by_phone ?? 0;
        acc.matched_by_cep += r?.matched_by_cep ?? 0;
        acc.matched_by_district += r?.matched_by_district ?? 0;
        acc.matched_by_serp += r?.matched_by_serp ?? 0;
        acc.not_found += r?.not_found ?? 0;
        acc.processed += r?.processed ?? 0;
        acc.remaining = r?.remaining ?? 0;
        if (i === 0) acc.initialRemaining = (r?.processed ?? 0) + (r?.remaining ?? 0);
        acc.exhausted = !!r?.exhausted;
        setBackfillResult({ ...acc });
        onDone();
        // Continua enquanto o lote leu algo. Só para quando não há mais o
        // que processar (processed=0) — não olha só "updated" porque um lote
        // inteiro de not_found também precisa avançar para o próximo.
        if ((r?.processed ?? 0) === 0 || (r?.remaining ?? 0) === 0) break;
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao completar sócios");
    } finally {
      setPhase("done");
    }
  }

  async function submit() {
    const hasCity = city.trim().length > 0;
    reset();
    if (hasCity) {
      reset();
      try {
        const res = await start({ data: { city, niche, maxResults } });
        setJobId(res.jobId); setStatus("running"); setProgress(5); setPhase("maps");
      } catch (e: any) {
        toast.error(e?.message ?? "Falha ao iniciar");
        setPhase("idle");
      }
    } else {
      // Sem cidade → só backfill da base existente
      await runBackfillPhase();
    }
  }

  // Polling do job Apify+CNPJ
  useEffect(() => {
    if (!jobId || phase !== "maps" && phase !== "cnpj") return;
    if (status === "done" || status === "failed") return;
    const t = setInterval(async () => {
      try {
        const j: any = await sync({ data: { jobId } });
        setStatus(j.status);
        setProgress(j.progress ?? 0);
        if ((j.progress ?? 0) > 30) setPhase("cnpj");
        if (j.status === "done") {
          setCreated(j.leads_created ?? 0);
          setRejectedCategory(j.rejected_category ?? 0);
          if ((j.rejected_category ?? 0) > 0) {
            toast.message(`${j.rejected_category} places descartados (não são autoescola)`);
          }
          onDone();
          // Fase seguinte: backfill de sócios sobre a base inteira
          runBackfillPhase();
        } else if (j.status === "failed") {
          toast.error(j.error ?? "Falha na busca");
          setPhase("done");
        }
      } catch (e: any) {
        toast.error(e?.message ?? "Erro ao sincronizar");
        setStatus("failed");
        setPhase("done");
      }
    }, 4000);
    return () => clearInterval(t);
  }, [jobId, status, phase, sync, onDone]);

  const busy = phase !== "idle" && phase !== "done";

  const phaseLabel =
    phase === "maps" ? "Buscando no Google Maps..." :
    phase === "cnpj" ? "Cruzando com Receita (CNPJá)..." :
    phase === "backfill" ? `Completando proprietários da base${batchNum > 0 ? ` (lote ${batchNum})` : ""}...` :
    phase === "done" ? "Concluído" : "";

  // Progresso real durante o backfill: processados / total_inicial
  const backfillPct = (() => {
    if (!backfillResult) return 0;
    const total = backfillResult.initialRemaining ?? 0;
    if (total <= 0) return phase === "done" ? 100 : 5;
    return Math.min(99, Math.round(((backfillResult.processed ?? 0) / total) * 100));
  })();
  const totalProgress =
    phase === "maps" ? Math.min(45, Math.round(progress * 0.5)) :
    phase === "cnpj" ? 45 + Math.round(Math.max(0, progress - 30) * 0.7) :
    phase === "backfill" ? backfillPct :
    phase === "done" ? 100 : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button className="rounded-2xl">
          <Radar className="mr-2 h-4 w-4" /> Buscar leads
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg rounded-3xl">
        <DialogHeader>
          <DialogTitle>Buscar leads</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Um clique só: Google Maps encontra quem está operando → CNPJá cruza para trazer proprietário, QSA e capital → completa a base antiga automaticamente no final.
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nicho</Label>
              <Input className="rounded-xl" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Autoescola" disabled={busy} />
            </div>
            <div>
              <Label>Cidade <span className="text-[10px] font-normal text-muted-foreground">(opcional)</span></Label>
              <Input className="rounded-xl" value={city} onChange={(e) => setCity(e.target.value)} placeholder="São Paulo" disabled={busy} />
            </div>
          </div>
          <div>
            <Label>Máx. de resultados</Label>
            <Input type="number" min={5} max={200} className="rounded-xl" value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value) || 40)} disabled={busy || !city.trim()} />
          </div>
          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-primary/5 p-3 text-xs">
            <div className="mb-2 flex items-center gap-2 font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Base atual
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatChip label="Sem proprietário" value={stats?.noSocios ?? "—"} />
              <StatChip label="Sem CNPJ" value={stats?.noCnpj ?? "—"} />
            </div>
            <p className="mt-2 text-muted-foreground">
              {city.trim()
                ? `Vai buscar novos leads em "${city.trim()}" e depois varrer os ${stats?.noSocios ?? "?"} leads sem proprietário.`
                : "Deixe a cidade em branco para apenas completar a base existente."}
            </p>
          </div>
        </div>

        {phase !== "idle" && (
          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-white/70 p-3 text-sm shadow-[var(--shadow-glass)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <span className="font-medium">{phaseLabel}</span>
              <span className="tabular-nums text-muted-foreground">{totalProgress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-primary/10">
              <div className="h-full bg-gradient-to-r from-primary to-[color:var(--primary-glow)] transition-all" style={{ width: `${totalProgress}%` }} />
            </div>
            {phase === "backfill" && backfillResult && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                <span className="font-medium text-foreground">Lote {batchNum}</span>
                <span>· {backfillResult.processed ?? 0} / {backfillResult.initialRemaining ?? 0} processados</span>
                <span className="text-emerald-600">✓ {backfillResult.matched}</span>
                <span className="text-rose-600">✗ {backfillResult.not_found ?? 0}</span>
                <span>· {backfillResult.remaining ?? 0} restam</span>
                <button
                  type="button"
                  onClick={() => { cancelRef.current = true; }}
                  className="ml-auto rounded-full border border-rose-200 px-2 py-0.5 text-[10px] font-semibold text-rose-600 hover:bg-rose-50"
                >
                  Cancelar após o lote
                </button>
              </div>
            )}
            {phase === "done" && (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {created !== null && <div>✓ {created} novos leads adicionados.</div>}
                {backfillResult && (
                  <>
                    <div>✓ {backfillResult.ok} leads com CNPJ receberam QSA.</div>
                    <div>
                      ✓ {backfillResult.matched} proprietários descobertos
                      {" ("}
                      nome: {backfillResult.matched_by_name ?? 0}
                      {" · "}telefone: {backfillResult.matched_by_phone ?? 0}
                      {" · "}CEP: {backfillResult.matched_by_cep ?? 0}
                      {" · "}bairro: {backfillResult.matched_by_district ?? 0}
                      {" · "}busca: {backfillResult.matched_by_serp ?? 0}
                      {")"}
                    </div>
                    {(backfillResult.not_found ?? 0) > 0 && (
                      <div>· {backfillResult.not_found} sem match (marcados p/ pular).</div>
                    )}
                    {(backfillResult.remaining ?? 0) > 0 && (
                      <div className="text-amber-600">
                        ⏱ {backfillResult.remaining} leads ainda pendentes — clique novamente para continuar.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {busy && (
              <p className="mt-2 text-xs text-muted-foreground">Pode fechar esta janela — o processamento continua no servidor.</p>
            )}
          </div>
        )}

        <Button onClick={submit} disabled={busy} className="w-full rounded-2xl">
          {busy
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando…</>
            : city.trim()
              ? <><Radar className="mr-2 h-4 w-4" /> Buscar e enriquecer tudo</>
              : <><Users2 className="mr-2 h-4 w-4" /> Completar base existente</>}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function StatChip({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-white/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function NewLeadDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nome_fantasia: "", telefone_1: "", bairro: "" });
  async function submit() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("leads").insert({ user_id: u.user.id, ...form, status: "new", source: "manual" });
    if (error) return toast.error(error.message);
    toast.success("Lead adicionado");
    setForm({ nome_fantasia: "", telefone_1: "", bairro: "" });
    setOpen(false); onCreated();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="rounded-2xl"><Plus className="mr-2 h-4 w-4" /> Novo lead</Button></DialogTrigger>
      <DialogContent className="rounded-3xl">
        <DialogHeader><DialogTitle>Novo lead</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Empresa</Label><Input className="rounded-xl" value={form.nome_fantasia} onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })} /></div>
          <div><Label>Telefone</Label><Input className="rounded-xl" value={form.telefone_1} onChange={(e) => setForm({ ...form, telefone_1: e.target.value })} /></div>
          <div><Label>Bairro</Label><Input className="rounded-xl" value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} /></div>
          <Button onClick={submit} className="w-full rounded-2xl">Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const split = (line: string) => {
    const out: string[] = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === sep && !inQ) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur); return out.map((s) => s.trim());
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = split(line); const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ""; });
    return row;
  });
}

function pick(row: Record<string, string>, keys: string[]) {
  for (const k of keys) {
    const found = Object.keys(row).find((h) => h.replace(/\s+/g, "").includes(k));
    if (found && row[found]) return row[found];
  }
  return "";
}

function mapRow(row: Record<string, string>, userId: string) {
  const cap = pick(row, ["capitalsocial", "capital"]);
  return {
    user_id: userId,
    status: "new",
    source: "csv",
    razao_social: pick(row, ["razaosocial", "razao"]) || null,
    nome_fantasia: pick(row, ["nomefantasia", "fantasia", "empresa", "nome"]) || null,
    cnpj: onlyDigits(pick(row, ["cnpj"])) || null,
    telefone_1: pick(row, ["telefone1", "tel1", "telefone", "fone"]) || null,
    telefone_2: pick(row, ["telefone2", "tel2"]) || null,
    bairro: pick(row, ["bairro"]) || null,
    cidade: pick(row, ["cidade", "municipio"]) || null,
    uf: pick(row, ["uf", "estado"]) || null,
    endereco: pick(row, ["endereco", "logradouro"]) || null,
    capital_social: cap ? Number(onlyDigits(cap)) / 100 || null : null,
    data_abertura: pick(row, ["dataabertura", "abertura"]) || null,
    email: pick(row, ["email"]) || null,
    whatsapp: pick(row, ["whatsapp", "wpp"]) || null,
    notas: pick(row, ["socio", "sócio", "responsavel"]) || null,
  };
}