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
import { Upload, Search, Plus, Trash2, Sparkles, Wand2, Loader2 } from "lucide-react";
import { formatBRL, formatPhoneBR, onlyDigits } from "@/lib/goldenMath";
import { enrichLeadCnpj, enrichMissingSocios, startEnrichmentJob, syncEnrichmentJob } from "@/lib/enrichment.functions";

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

  const filtered = useMemo(() => {
    if (!q) return leads;
    const t = q.toLowerCase();
    return leads.filter((l) =>
      [l.nome_fantasia, l.razao_social, l.bairro, l.cidade, l.telefone_1, l.telefone_2, l.cnpj]
        .filter(Boolean).some((s) => String(s).toLowerCase().includes(t))
    );
  }, [leads, q]);

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
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="mt-1 text-muted-foreground">{leads.length} leads · fila do Modo Foco</p>
        </div>
        <div className="flex gap-2">
          <ApifyEnrichDialog onQueued={() => qc.invalidateQueries({ queryKey: ["leads"] })} />
          <BackfillSociosButton onDone={() => qc.invalidateQueries({ queryKey: ["leads"] })} />
          <Button variant="outline" className="rounded-2xl" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Importar CSV
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          <NewLeadDialog onCreated={() => qc.invalidateQueries({ queryKey: ["leads"] })} />
        </div>
      </div>

      <Card className="rounded-3xl border-border shadow-[var(--shadow-soft)]">
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="rounded-xl pl-9" placeholder="Buscar por nome, telefone, cidade..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-56 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Capital</TableHead>
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
                    <TableCell><Badge variant="secondary" className="rounded-full">{l.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <EnrichCnpjButton lead={l} />
                      <Button size="icon" variant="ghost" className="rounded-xl" onClick={() => del.mutate(l.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Nenhum lead encontrado.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EnrichCnpjButton({ lead }: { lead: any }) {
  return <_EnrichCnpjButtonImpl lead={lead} />;
}

function BackfillSociosButton({ onDone }: { onDone: () => void }) {
  const run = useServerFn(enrichMissingSocios);
  const [loading, setLoading] = useState(false);
  async function go() {
    setLoading(true);
    try {
      const r: any = await run();
      toast.success(`Sócios: ${r?.ok ?? 0} atualizados · ${r?.matched ?? 0} novos CNPJs encontrados`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao buscar sócios");
    } finally { setLoading(false); }
  }
  return (
    <Button variant="outline" className="rounded-2xl" onClick={go} disabled={loading}>
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
      Buscar sócios
    </Button>
  );
}

function _EnrichCnpjButtonImpl({ lead }: { lead: any }) {
  const qc = useQueryClient();
  const enrich = useServerFn(enrichLeadCnpj);
  const [loading, setLoading] = useState(false);
  if (!lead.cnpj) return null;
  async function run() {
    setLoading(true);
    try {
      await enrich({ data: { leadId: lead.id } });
      toast.success("CNPJ enriquecido");
      qc.invalidateQueries({ queryKey: ["leads"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao enriquecer");
    } finally { setLoading(false); }
  }
  return (
    <Button size="icon" variant="ghost" className="rounded-xl" title="Enriquecer CNPJ" onClick={run} disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-primary" />}
    </Button>
  );
}

function ApifyEnrichDialog({ onQueued }: { onQueued: () => void }) {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState("");
  const [niche, setNiche] = useState("Autoescola");
  const [maxResults, setMaxResults] = useState(40);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [created, setCreated] = useState<number | null>(null);
  const start = useServerFn(startEnrichmentJob);
  const sync = useServerFn(syncEnrichmentJob);

  async function submit() {
    if (!city.trim()) return toast.error("Informe a cidade");
    try {
      const res = await start({ data: { city, niche, maxResults } });
      setJobId(res.jobId); setStatus("running"); setProgress(10); setCreated(null);
      toast.success("Busca iniciada no Google Maps");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao iniciar");
    }
  }

  useEffect(() => {
    if (!jobId || status === "done" || status === "failed") return;
    const t = setInterval(async () => {
      try {
        const j: any = await sync({ data: { jobId } });
        setStatus(j.status); setProgress(j.progress ?? 0);
        if (j.status === "done") {
          setCreated(j.leads_created ?? 0);
          toast.success(`${j.leads_created ?? 0} leads adicionados`);
          onQueued();
        } else if (j.status === "failed") {
          toast.error(j.error ?? "Falha na busca");
        }
      } catch (e: any) {
        toast.error(e?.message ?? "Erro ao sincronizar");
        setStatus("failed");
      }
    }, 4000);
    return () => clearInterval(t);
  }, [jobId, status, sync, onQueued]);

  const running = jobId && status !== "done" && status !== "failed";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setJobId(null); setStatus(""); setProgress(0); setCreated(null); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-2xl"><Wand2 className="mr-2 h-4 w-4" /> Buscar no Google Maps</Button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl">
        <DialogHeader><DialogTitle>Enriquecimento por nicho + cidade</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Nicho</Label><Input className="rounded-xl" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Autoescola" /></div>
            <div><Label>Cidade</Label><Input className="rounded-xl" value={city} onChange={(e) => setCity(e.target.value)} placeholder="São Paulo" /></div>
          </div>
          <div>
            <Label>Máx. de resultados</Label>
            <Input type="number" min={5} max={200} className="rounded-xl" value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value) || 40)} />
          </div>

          {jobId && (
            <div className="rounded-2xl border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {status === "done" ? "Concluído" : status === "failed" ? "Falhou" : "Buscando no Google Maps..."}
                </span>
                <span className="tabular-nums text-muted-foreground">{progress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              {created !== null && <div className="mt-2 text-muted-foreground">{created} leads adicionados à sua base.</div>}
              <p className="mt-2 text-xs text-muted-foreground">Você pode fechar esta janela — o processamento continua no servidor.</p>
            </div>
          )}

          <Button onClick={submit} disabled={!!running} className="w-full rounded-2xl">
            {running ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando…</> : "Iniciar busca"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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