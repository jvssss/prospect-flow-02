import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  X,
  MessageCircle,
  Phone,
  CalendarClock,
  Trash2,
  Check,
  Loader2,
  Flame,
  Snowflake,
} from "lucide-react";
import { formatBRL, formatPhoneBR, whatsappLink } from "@/lib/goldenMath";
import { mensagemAbertura, numeroWhatsapp, venceEm } from "@/lib/cadencia";

/** Etiquetas do funil, na ordem em que o lead costuma andar. */
const ETIQUETAS = [
  "Novo Lead",
  "Atendida",
  "Lead Qualificado",
  "É Decisor",
  "Contato com Decisor",
  "Destravar em Reunião",
  "Reunião Marcada",
  "R1 Feita",
  "Reunião Realizada",
  "Proposta Enviada",
  "Destravar Proposta",
  "Fechado",
  "Venda",
  "Perda",
  "Não Atendeu",
  "Ligar Depois",
  "No-show",
];

const TEMPERATURAS = ["Quente", "Morno", "Frio"];
const ICPS = ["Ideal", "Adequado", "Fora do perfil"];

/** Atalhos de cadência: reagenda a próxima ação em N dias. */
const ATALHOS_DIAS = [1, 3, 5, 10];

type Campo = {
  chave: string;
  rotulo: string;
  tipo?: "texto" | "telefone" | "moeda";
  somenteLeitura?: boolean;
};

const CAMPOS: Campo[] = [
  { chave: "telefone_1", rotulo: "Telefone", tipo: "telefone" },
  { chave: "email", rotulo: "E-mail" },
  { chave: "proprietario", rotulo: "Decisor" },
  { chave: "nome_ponte", rotulo: "Gatekeeper" },
  { chave: "instagram", rotulo: "Instagram" },
  { chave: "website", rotulo: "Site" },
  { chave: "google_meu_negocio", rotulo: "Google Meu Negócio" },
  { chave: "meta_ads", rotulo: "Meta Ads" },
  { chave: "google_ads", rotulo: "Google Ads" },
  { chave: "social_media", rotulo: "Social Media" },
];

/**
 * Campos do lead usados aqui. A interseção com Record<string, unknown> permite
 * o acesso por chave que a grade de CAMPOS faz, sem abrir mão do tipo nos
 * campos nomeados.
 */
type LeadCompleto = {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  proprietario: string | null;
  nome_ponte: string | null;
  telefone_1: string | null;
  telefone_2: string | null;
  whatsapp: string | null;
  icp: string | null;
  temperatura: string | null;
  oportunidade: number | null;
  responsavel: string | null;
  etiquetas: string[] | null;
  cadencia_etapa: number | null;
  cadencia_proximo_em: string | null;
  cadencia_status: string | null;
  last_call_at: string | null;
  source: string | null;
} & Record<string, unknown>;

type ToqueHistorico = {
  outcome: string;
  notes: string | null;
  created_at: string;
};

function fmtDataHora(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Campo que vira input ao clicar. Vazio mostra o convite para preencher. */
function CampoEditavel({
  rotulo,
  valor,
  tipo,
  onSalvar,
}: {
  rotulo: string;
  valor: string | number | null;
  tipo?: Campo["tipo"];
  onSalvar: (v: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState(false);

  const vazio = valor === null || valor === undefined || valor === "";
  const exibicao = vazio
    ? null
    : tipo === "telefone"
      ? formatPhoneBR(String(valor)) || String(valor)
      : tipo === "moeda"
        ? formatBRL(Number(valor))
        : String(valor);

  async function confirmar() {
    setSalvando(true);
    try {
      await onSalvar(rascunho.trim());
      setEditando(false);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-white/60 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {rotulo}
      </div>
      {editando ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Input
            autoFocus
            className="h-8 rounded-lg"
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmar();
              if (e.key === "Escape") setEditando(false);
            }}
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg"
            disabled={salvando}
            onClick={confirmar}
          >
            {salvando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setRascunho(vazio ? "" : String(valor));
            setEditando(true);
          }}
          className="mt-1 block w-full truncate text-left text-sm hover:underline"
        >
          {exibicao ?? <span className="text-primary">+ Adicionar informação</span>}
        </button>
      )}
    </div>
  );
}

export function LeadProfile({
  leadId,
  open,
  onOpenChange,
  onChanged,
}: {
  leadId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const db = supabase as unknown as SupabaseClient;
  const [ocupado, setOcupado] = useState(false);

  const { data: lead, refetch } = useQuery({
    queryKey: ["lead-profile", leadId],
    enabled: !!leadId && open,
    queryFn: async () => {
      const { data, error } = await db.from("leads").select("*").eq("id", leadId).maybeSingle();
      if (error) throw error;
      return data as LeadCompleto | null;
    },
  });

  const { data: historico = [] } = useQuery({
    queryKey: ["lead-historico", leadId],
    enabled: !!leadId && open,
    queryFn: async () => {
      const { data } = await db
        .from("call_logs")
        .select("outcome, notes, created_at")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(8);
      return (data ?? []) as ToqueHistorico[];
    },
  });

  // Fecha ao trocar de lead para não mostrar dados do anterior.
  useEffect(() => {
    setOcupado(false);
  }, [leadId]);

  async function salvar(patch: Record<string, unknown>): Promise<void> {
    if (!leadId) return;
    const { error } = await db.from("leads").update(patch).eq("id", leadId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refetch();
    qc.invalidateQueries({ queryKey: ["disparo-leads"] });
    onChanged?.();
  }

  async function alternarEtiqueta(tag: string) {
    const atuais: string[] = lead?.etiquetas ?? [];
    const novas = atuais.includes(tag) ? atuais.filter((t) => t !== tag) : [...atuais, tag];
    await salvar({ etiquetas: novas });
  }

  /** Reagenda a próxima ação para daqui a N dias, sem mexer na etapa. */
  async function agendarEm(dias: number) {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    await salvar({ cadencia_proximo_em: d.toISOString(), cadencia_status: "ativa" });
    toast.success(`Próxima ação em ${dias} ${dias === 1 ? "dia" : "dias"}`);
  }

  /** Registra um toque e empurra a cadência, igual à lista de Disparo. */
  async function registrarToque(canal: "whatsapp" | "ligacao") {
    if (!lead) return;
    setOcupado(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return toast.error("Sessão expirada");
      const etapa = (lead.cadencia_etapa ?? 0) + 1;
      await db.from("disparos").insert({ lead_id: lead.id, user_id: u.user.id, canal, etapa });
      const prox = venceEm(etapa);
      await salvar({
        cadencia_etapa: etapa,
        cadencia_proximo_em: prox ? prox.toISOString() : null,
        cadencia_status: "ativa",
        last_call_at: canal === "ligacao" ? new Date().toISOString() : lead.last_call_at,
      });
      toast.success(`Toque ${etapa} registrado`);
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!leadId) return;
    setOcupado(true);
    const { error } = await db.from("leads").delete().eq("id", leadId);
    setOcupado(false);
    if (error) return toast.error(error.message);
    toast.success("Lead excluído");
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["disparo-leads"] });
    onChanged?.();
  }

  const zap = lead ? numeroWhatsapp(lead) : null;
  const etiquetas: string[] = lead?.etiquetas ?? [];
  const empresa = lead?.nome_fantasia ?? lead?.razao_social ?? "Lead";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {!lead ? (
          <div className="p-8 text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <>
            {/* cabeçalho */}
            <div className="bg-foreground px-6 py-5 text-background">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-60">
                    Perfil do lead
                  </div>
                  <h2 className="mt-1 truncate text-2xl font-semibold">
                    {lead.proprietario ?? empresa}
                  </h2>
                  {lead.proprietario && (
                    <div className="truncate text-sm opacity-70">{empresa}</div>
                  )}
                </div>
                <button
                  onClick={() => onOpenChange(false)}
                  className="rounded-full p-1 opacity-70 hover:opacity-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <SeletorTopo
                  rotulo="ICP"
                  valor={lead.icp}
                  opcoes={ICPS}
                  onEscolher={(v) => salvar({ icp: v })}
                />
                <SeletorTopo
                  rotulo="Temperatura"
                  valor={lead.temperatura}
                  opcoes={TEMPERATURAS}
                  onEscolher={(v) => salvar({ temperatura: v })}
                />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-60">
                    Oportunidade
                  </div>
                  <div className="mt-1 font-semibold">
                    {formatBRL(Number(lead.oportunidade ?? 0))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-5 p-6">
              {/* próxima ação */}
              <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-primary/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Próxima ação
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {fmtDataHora(lead.cadencia_proximo_em) ?? "Não agendada"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Toque {lead.cadencia_etapa ?? 0}/4 · {lead.cadencia_status ?? "ativa"}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Agendar cadência
                    </div>
                    <div className="flex gap-1.5">
                      {ATALHOS_DIAS.map((d) => (
                        <Button
                          key={d}
                          size="sm"
                          variant="outline"
                          className="h-8 w-11 rounded-lg px-0 text-xs"
                          onClick={() => agendarEm(d)}
                        >
                          D{d}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* registrar contato */}
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Registrar contato
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {zap ? (
                    <Button
                      size="sm"
                      disabled={ocupado}
                      className="rounded-xl"
                      onClick={() => {
                        window.open(
                          whatsappLink(zap, mensagemAbertura(empresa, lead.proprietario)),
                          "_blank",
                          "noopener,noreferrer",
                        );
                        registrarToque("whatsapp");
                      }}
                    >
                      <MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled
                      className="rounded-xl"
                      title="Só telefone fixo"
                    >
                      <MessageCircle className="mr-1.5 h-4 w-4" /> sem celular
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ocupado}
                    className="rounded-xl"
                    onClick={() => registrarToque("ligacao")}
                  >
                    <Phone className="mr-1.5 h-4 w-4" /> Ligação
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() =>
                      salvar({ cadencia_status: "respondeu", cadencia_proximo_em: null })
                    }
                  >
                    Respondeu
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-xl text-muted-foreground"
                    onClick={() =>
                      salvar({ cadencia_status: "encerrada", cadencia_proximo_em: null })
                    }
                  >
                    Encerrar
                  </Button>
                </div>
              </div>

              <Separator />

              {/* etiquetas */}
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Etiquetas
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ETIQUETAS.map((t) => {
                    const ativa = etiquetas.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => alternarEtiqueta(t)}
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          ativa
                            ? "border-transparent bg-foreground text-background"
                            : "border-[color:var(--border-subtle)] bg-white/60 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Separator />

              {/* campos */}
              <div className="grid gap-2 sm:grid-cols-2">
                {CAMPOS.map((c) => (
                  <CampoEditavel
                    key={c.chave}
                    rotulo={c.rotulo}
                    valor={(lead[c.chave] as string | number | null) ?? null}
                    tipo={c.tipo}
                    onSalvar={(v) => salvar({ [c.chave]: v || null })}
                  />
                ))}
                <CampoEditavel
                  rotulo="Oportunidade (R$)"
                  valor={lead.oportunidade}
                  tipo="moeda"
                  onSalvar={(v) =>
                    salvar({
                      oportunidade: v ? Number(v.replace(/[^\d,.-]/g, "").replace(",", ".")) : null,
                    })
                  }
                />
                <CampoEditavel
                  rotulo="Responsável"
                  valor={lead.responsavel}
                  onSalvar={(v) => salvar({ responsavel: v || null })}
                />
                <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-white/60 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Último contato
                  </div>
                  <div className="mt-1 text-sm">{fmtDataHora(lead.last_call_at) ?? "—"}</div>
                </div>
                <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-white/60 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Origem
                  </div>
                  <div className="mt-1 text-sm">
                    {lead.source === "apify_gmaps" ? "Prospecção ativa" : (lead.source ?? "—")}
                  </div>
                </div>
              </div>

              {/* histórico */}
              {historico.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Histórico de contato
                    </div>
                    <div className="space-y-1.5">
                      {historico.map((h, i) => (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-white/50 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{h.outcome}</span>
                            <span className="text-muted-foreground">
                              {fmtDataHora(h.created_at)}
                            </span>
                          </div>
                          {h.notes && <div className="mt-0.5 text-muted-foreground">{h.notes}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <Separator />

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    className="rounded-2xl text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Excluir lead
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-3xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir este lead?</AlertDialogTitle>
                    <AlertDialogDescription>
                      <b className="text-foreground">{empresa}</b> será removido permanentemente, e
                      não dá para desfazer. As ligações já registradas continuam contando nos seus
                      números do dia, mas deixam de aparecer ligadas a esta empresa.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-2xl">Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        excluir();
                      }}
                      disabled={ocupado}
                      className="rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Excluir permanentemente
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Seletor compacto do cabeçalho: clica e cicla entre as opções. */
function SeletorTopo({
  rotulo,
  valor,
  opcoes,
  onEscolher,
}: {
  rotulo: string;
  valor: string | null;
  opcoes: string[];
  onEscolher: (v: string) => void;
}) {
  const proximo = () => {
    const i = valor ? opcoes.indexOf(valor) : -1;
    onEscolher(opcoes[(i + 1) % opcoes.length]);
  };
  const Icone = valor === "Quente" ? Flame : valor === "Frio" ? Snowflake : null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-60">
        {rotulo}
      </div>
      <button
        onClick={proximo}
        className="mt-1 inline-flex items-center gap-1 font-semibold hover:underline"
      >
        {Icone && <Icone className="h-3.5 w-3.5" />}
        {valor ?? <span className="opacity-60">Não classificado</span>}
      </button>
    </div>
  );
}
