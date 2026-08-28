import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageCircle,
  Phone,
  Search,
  CalendarClock,
  Flame,
  Clock,
  CheckCheck,
  UserCheck,
  Ban,
} from "lucide-react";
import { formatPhoneBR, whatsappLink } from "@/lib/goldenMath";
import {
  CADENCIA,
  ROTULO_SITUACAO,
  SITUACOES_ACIONAVEIS,
  TOTAL_PASSOS,
  mensagemAbertura,
  numeroWhatsapp,
  proximoPasso,
  situacao,
  venceEm,
  type Canal,
  type PassoCadencia,
  type SituacaoLead,
} from "@/lib/cadencia";

export const Route = createFileRoute("/_authenticated/disparo")({
  head: () => ({
    meta: [
      { title: "Controle de Disparo · Meta Prospect" },
      { name: "description", content: "Cadência, follow-ups e disparo de WhatsApp por lead." },
    ],
  }),
  component: DisparoPage,
});

/** Espelha exatamente o select abaixo. */
type Lead = {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  telefone_1: string | null;
  telefone_2: string | null;
  whatsapp: string | null;
  proprietario: string | null;
  socios: unknown;
  notas: string | null;
  status: string | null;
  pipeline_stage: string | null;
  cadencia_etapa: number | null;
  cadencia_proximo_em: string | null;
  cadencia_status: string | null;
  last_call_at: string | null;
  followup_at: string | null;
};

type LeadNaCadencia = Lead & {
  _sit: SituacaoLead;
  _zap: string | null;
  _proximo: PassoCadencia | null;
  _temInfo: boolean;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
function fmtData(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  if (mesmoDia) return `hoje ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

const CORES: Partial<Record<SituacaoLead, string>> = {
  vencido: "bg-destructive/10 text-destructive border-destructive/20",
  hoje: "bg-primary/10 text-primary border-primary/20",
  novo: "bg-foreground/5 text-foreground border-border",
  respondeu: "bg-primary/10 text-primary border-primary/20",
};

function DisparoPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filtroSituacao, setFiltroSituacao] = useState("acionaveis");
  const [filtroDecisor, setFiltroDecisor] = useState("all");
  const [filtroCanal, setFiltroCanal] = useState("all");
  const [filtroCidade, setFiltroCidade] = useState("all");
  const [ocupado, setOcupado] = useState<string | null>(null);

  // cadencia_* e a tabela disparos foram criadas fora do agente do Lovable e
  // ainda não constam no types.ts gerado.
  const db = supabase as unknown as SupabaseClient;

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["disparo-leads"],
    queryFn: async () => {
      const { data, error } = await db
        .from("leads")
        .select(
          "id,nome_fantasia,razao_social,cidade,uf,bairro,telefone_1,telefone_2,whatsapp,proprietario,socios,notas,status,pipeline_stage,cadencia_etapa,cadencia_proximo_em,cadencia_status,last_call_at,followup_at",
        )
        .order("cadencia_proximo_em", { ascending: true, nullsFirst: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  const cidades = useMemo(
    () => [...new Set(leads.map((l) => l.cidade).filter(Boolean))].sort() as string[],
    [leads],
  );

  const enriquecidos: LeadNaCadencia[] = useMemo(
    () =>
      leads.map((l) => {
        const sit = situacao(l);
        return {
          ...l,
          _sit: sit,
          _zap: numeroWhatsapp(l),
          _proximo: proximoPasso(l.cadencia_etapa),
          _temInfo: !!(l.proprietario || l.notas || l.followup_at),
        };
      }),
    [leads],
  );

  const filtrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    return enriquecidos.filter((l) => {
      if (filtroSituacao === "acionaveis" && !SITUACOES_ACIONAVEIS.includes(l._sit)) return false;
      if (filtroSituacao !== "acionaveis" && filtroSituacao !== "all" && l._sit !== filtroSituacao)
        return false;
      if (filtroDecisor === "com" && !l.proprietario) return false;
      if (filtroDecisor === "sem" && l.proprietario) return false;
      if (filtroDecisor === "info" && !l._temInfo) return false;
      if (filtroCanal === "zap" && !l._zap) return false;
      if (filtroCanal === "fixo" && l._zap) return false;
      if (filtroCidade !== "all" && l.cidade !== filtroCidade) return false;
      if (termo) {
        const alvo =
          `${l.nome_fantasia ?? ""} ${l.razao_social ?? ""} ${l.proprietario ?? ""} ${l.cidade ?? ""}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [enriquecidos, q, filtroSituacao, filtroDecisor, filtroCanal, filtroCidade]);

  const resumo = useMemo(() => {
    const conta = (s: SituacaoLead) => enriquecidos.filter((l) => l._sit === s).length;
    return {
      acionaveis: enriquecidos.filter((l) => SITUACOES_ACIONAVEIS.includes(l._sit)).length,
      vencidos: conta("vencido"),
      agendados: conta("agendado"),
      comZap: enriquecidos.filter((l) => l._zap && SITUACOES_ACIONAVEIS.includes(l._sit)).length,
    };
  }, [enriquecidos]);

  /** Grava o toque e empurra a cadência para o passo seguinte. */
  async function registrar(lead: Lead, canal: Canal) {
    setOcupado(lead.id);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return toast.error("Sessão expirada");
      const etapa = (lead.cadencia_etapa ?? 0) + 1;
      const { error: dErr } = await db
        .from("disparos")
        .insert({ lead_id: lead.id, user_id: u.user.id, canal, etapa });
      if (dErr) return toast.error(dErr.message);

      const prox = venceEm(etapa);
      const { error: lErr } = await db
        .from("leads")
        .update({
          cadencia_etapa: etapa,
          cadencia_proximo_em: prox ? prox.toISOString() : null,
          cadencia_status: "ativa",
        })
        .eq("id", lead.id);
      if (lErr) return toast.error(lErr.message);

      qc.invalidateQueries({ queryKey: ["disparo-leads"] });
      toast.success(
        prox
          ? `Toque ${etapa} registrado · próximo em ${fmtData(prox.toISOString())}`
          : `Toque ${etapa} registrado · cadência esgotada`,
      );
    } finally {
      setOcupado(null);
    }
  }

  async function marcar(lead: Lead, status: "respondeu" | "encerrada") {
    setOcupado(lead.id);
    try {
      const { error } = await db
        .from("leads")
        .update({ cadencia_status: status, cadencia_proximo_em: null })
        .eq("id", lead.id);
      if (error) return toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["disparo-leads"] });
      toast.success(status === "respondeu" ? "Marcado como respondeu" : "Cadência encerrada");
    } finally {
      setOcupado(null);
    }
  }

  function abrirWhatsapp(lead: LeadNaCadencia) {
    const num = lead._zap;
    if (!num) return;
    const msg = mensagemAbertura(lead.nome_fantasia ?? lead.razao_social, lead.proprietario);
    window.open(whatsappLink(num, msg), "_blank", "noopener,noreferrer");
    registrar(lead, "whatsapp");
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Cadência
          </div>
          <h1 className="mt-1 text-4xl tracking-tight md:text-5xl">Controle de Disparo</h1>
          <p className="mt-1 text-muted-foreground">
            {resumo.acionaveis} leads pedindo ação · {resumo.comZap} com WhatsApp
          </p>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Flame} label="Pedindo ação" value={String(resumo.acionaveis)} />
        <Stat icon={Clock} label="Atrasados" value={String(resumo.vencidos)} />
        <Stat icon={CalendarClock} label="Agendados" value={String(resumo.agendados)} />
        <Stat icon={MessageCircle} label="Com WhatsApp" value={String(resumo.comZap)} />
      </div>

      <Card className="mb-4 rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
        <CardContent className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            A cadência
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {CADENCIA.map((p, i) => (
              <div key={p.etapa} className="flex items-center gap-2">
                <div className="rounded-2xl border border-border bg-white/70 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {p.canal === "whatsapp" ? (
                      <MessageCircle className="h-3.5 w-3.5" />
                    ) : (
                      <Phone className="h-3.5 w-3.5" />
                    )}
                    D+{p.dia}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{p.titulo}</div>
                </div>
                {i < CADENCIA.length - 1 && <span className="text-muted-foreground">→</span>}
              </div>
            ))}
            <span className="text-muted-foreground">→</span>
            <div className="rounded-2xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              D+14 encerra
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="rounded-xl pl-9"
                placeholder="Empresa, decisor, cidade..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={filtroSituacao} onValueChange={setFiltroSituacao}>
              <SelectTrigger className="w-48 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="acionaveis">Pedindo ação</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="novo">Nunca tocados</SelectItem>
                <SelectItem value="vencido">Atrasados</SelectItem>
                <SelectItem value="hoje">Vencem hoje</SelectItem>
                <SelectItem value="agendado">Agendados</SelectItem>
                <SelectItem value="esgotada">Cadência esgotada</SelectItem>
                <SelectItem value="respondeu">Responderam</SelectItem>
                <SelectItem value="encerrada">Encerrados</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroDecisor} onValueChange={setFiltroDecisor}>
              <SelectTrigger className="w-52 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Decisor: todos</SelectItem>
                <SelectItem value="com">Com decisor</SelectItem>
                <SelectItem value="sem">Sem decisor</SelectItem>
                <SelectItem value="info">Com informação capturada</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroCanal} onValueChange={setFiltroCanal}>
              <SelectTrigger className="w-48 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Telefone: todos</SelectItem>
                <SelectItem value="zap">Só com WhatsApp</SelectItem>
                <SelectItem value="fixo">Só fixo</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroCidade} onValueChange={setFiltroCidade}>
              <SelectTrigger className="w-48 rounded-xl">
                <SelectValue placeholder="Cidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as cidades</SelectItem>
                {cidades.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto text-xs text-muted-foreground">
              {filtrados.length} de {leads.length}
            </div>
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : filtrados.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-sm font-medium">Nada pedindo ação agora.</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Leads novos entram aqui automaticamente quando você busca empresas.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filtrados.map((l) => {
                const passo = l._proximo;
                const etapa = l.cadencia_etapa ?? 0;
                const busy = ocupado === l.id;
                return (
                  <div
                    key={l.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-white/60 p-3"
                  >
                    <div className="min-w-56 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {l.nome_fantasia ?? l.razao_social ?? "—"}
                        </span>
                        <Badge
                          variant="outline"
                          className={`rounded-full text-[10px] ${CORES[l._sit] ?? ""}`}
                        >
                          {ROTULO_SITUACAO[l._sit]}
                        </Badge>
                        {l.proprietario && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <UserCheck className="h-3 w-3" /> {l.proprietario}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {[l.bairro, l.cidade].filter(Boolean).join(" · ")}
                        {" · "}
                        {formatPhoneBR(l.telefone_1) || "sem telefone"}
                        {!l._zap && l.telefone_1 && (
                          <span className="text-destructive"> (fixo)</span>
                        )}
                      </div>
                    </div>

                    <div className="text-xs tabular-nums text-muted-foreground">
                      <div>
                        Toque {Math.min(etapa, TOTAL_PASSOS)}/{TOTAL_PASSOS}
                      </div>
                      <div>{etapa > 0 ? fmtData(l.cadencia_proximo_em) : "—"}</div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {l._zap ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => abrirWhatsapp(l)}
                          className="rounded-xl bg-primary text-primary-foreground"
                          title={
                            passo ? `Toque ${passo.etapa}: ${passo.titulo}` : "Cadência esgotada"
                          }
                        >
                          <MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled
                          className="rounded-xl"
                          title="Este lead só tem telefone fixo — WhatsApp não chega"
                        >
                          <MessageCircle className="mr-1.5 h-4 w-4" /> sem celular
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => registrar(l, "ligacao")}
                        className="rounded-xl"
                        title="Registrar uma ligação nesta cadência"
                      >
                        <Phone className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => marcar(l, "respondeu")}
                        className="rounded-xl"
                        title="Respondeu — tira da cadência"
                      >
                        <CheckCheck className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => marcar(l, "encerrada")}
                        className="rounded-xl text-muted-foreground"
                        title="Encerrar cadência"
                      >
                        <Ban className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <Card className="rounded-3xl border-[color:var(--border-subtle)] bg-white/70 shadow-[var(--shadow-glass)] backdrop-blur-xl">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[color:var(--primary-glow)] text-primary-foreground shadow-[var(--shadow-elegant)]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </div>
          <div className="text-xl font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
