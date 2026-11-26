import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { protegido } from "../handler.server";
import { erros } from "../errors";
import { lerCorpo, lerQuery, metaPaginacao, ok, paginacao } from "../http";
import { venceEm } from "@/lib/cadencia";

const sb = (c: { db: unknown }) => c.db as SupabaseClient;

export const OUTCOMES = ["no_answer", "gatekeeper", "not_interested", "callback", "meeting_scheduled"] as const;
type Outcome = (typeof OUTCOMES)[number];

/** Mesmo mapa do Modo Foco: o que cada desfecho faz com o lead. */
const ESTAGIO: Record<Outcome, string> = {
  no_answer: "in_contact",
  gatekeeper: "in_contact",
  callback: "in_contact",
  not_interested: "dismissed",
  meeting_scheduled: "scheduled",
};
/** Ligação que chegou a falar com alguém conta como "decisor alcançado" no funil. */
const CONTA_COMO_DECISOR = new Set<Outcome>(["gatekeeper", "meeting_scheduled", "not_interested"]);

export function hojeSaoPaulo(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function leadId(c: { params: Record<string, string> }): string {
  if (!z.string().uuid().safeParse(c.params.id).success) throw erros.invalido("ID de lead inválido.");
  return c.params.id;
}

const iso = z.string().datetime({ offset: true });

const corpoLigacao = z.object({
  outcome: z.enum(OUTCOMES),
  duration_seconds: z.number().int().min(0).max(14_400).optional(),
  nome_ponte: z.string().trim().max(200).optional(),
  nome_decisor: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(5000).optional(),
  /** Data/hora do retorno (callback) ou da reunião (meeting_scheduled). */
  return_at: iso.optional(),
  followup_at: iso.optional(),
  followup_notes: z.string().trim().max(2000).optional(),
});

export const listarLigacoes = protegido(async (c) => {
  const id = leadId(c);
  const f = lerQuery(c.request, paginacao);
  const de = (f.page - 1) * f.limit;
  const { data, count, error } = await sb(c)
    .from("call_logs")
    .select("*", { count: "exact" })
    .eq("lead_id", id)
    .eq("user_id", c.userId)
    .order("created_at", { ascending: false })
    .range(de, de + f.limit - 1);
  if (error) throw erros.interno(error.message);
  return ok(data ?? [], metaPaginacao(count, f.limit, f.page));
});

/**
 * Registra uma ligação com a mesma regra do Modo Foco: atualiza o lead e a
 * cadência, grava o histórico e soma nas métricas do dia. Quem integra pelo
 * n8n ou por outro app obtém exatamente o mesmo efeito de clicar no painel.
 */
export const registrarLigacao = protegido(async (c) => {
  const id = leadId(c);
  const b = await lerCorpo(c.request, corpoLigacao);
  const o = b.outcome;

  const { data: lead, error: le } = await sb(c)
    .from("leads")
    .select("id,cadencia_etapa")
    .eq("id", id)
    .eq("user_id", c.userId)
    .maybeSingle();
  if (le) throw erros.interno(le.message);
  if (!lead) throw erros.naoEncontrado("Lead");

  const agora = new Date();
  const etapa = ((lead as { cadencia_etapa?: number | null }).cadencia_etapa ?? 0) + 1;
  const proximo = venceEm(etapa, agora);
  const statusCadencia = o === "meeting_scheduled" ? "respondeu" : o === "not_interested" ? "encerrada" : "ativa";

  const up: Record<string, unknown> = {
    status: o,
    pipeline_stage: ESTAGIO[o],
    last_call_at: agora.toISOString(),
    cadencia_etapa: etapa,
    cadencia_proximo_em: statusCadencia === "ativa" && proximo ? proximo.toISOString() : null,
    cadencia_status: statusCadencia,
  };
  if (b.nome_ponte) up.nome_ponte = b.nome_ponte;
  if (b.nome_decisor) up.proprietario = b.nome_decisor;
  if ((o === "callback" || o === "meeting_scheduled") && b.return_at) {
    up.retorno_agendado_em = b.return_at;
    if (o === "meeting_scheduled") up.meeting_at = b.return_at;
  }
  if (b.followup_at) {
    up.followup_at = b.followup_at;
    if (b.followup_notes) up.followup_notes = b.followup_notes;
  }

  const { error: ue } = await sb(c).from("leads").update(up).eq("id", id).eq("user_id", c.userId);
  if (ue) throw erros.interno(ue.message);

  const { data: log, error: ce } = await sb(c)
    .from("call_logs")
    .insert({
      user_id: c.userId,
      lead_id: id,
      outcome: o,
      duration_seconds: b.duration_seconds ?? null,
      nome_ponte: b.nome_ponte || null,
      scheduled_return_at: b.return_at ?? null,
      notes:
        [b.nome_decisor ? `Decisor: ${b.nome_decisor}` : null, b.notes || null].filter(Boolean).join(" · ") || null,
    })
    .select("*")
    .single();
  if (ce) throw erros.interno(ce.message);

  await sb(c).from("disparos").insert({ lead_id: id, user_id: c.userId, canal: "ligacao", etapa });

  const dia = hojeSaoPaulo(agora);
  const { data: atual } = await sb(c)
    .from("daily_metrics")
    .select("*")
    .eq("user_id", c.userId)
    .eq("day", dia)
    .maybeSingle();
  const cur = atual ?? { calls_made: 0, decisions_reached: 0, meetings_scheduled: 0, meetings_held: 0, closes: 0, revenue: 0 };
  const metrica = {
    ...cur,
    user_id: c.userId,
    day: dia,
    calls_made: (cur.calls_made ?? 0) + 1,
    decisions_reached: (cur.decisions_reached ?? 0) + (CONTA_COMO_DECISOR.has(o) ? 1 : 0),
    meetings_scheduled: (cur.meetings_scheduled ?? 0) + (o === "meeting_scheduled" ? 1 : 0),
  };
  const { error: me } = await sb(c).from("daily_metrics").upsert(metrica, { onConflict: "user_id,day" });
  if (me) throw erros.interno(me.message);

  return ok(
    { ligacao: log, lead: { id, ...up }, metricas_do_dia: metrica },
    { cadencia_etapa: etapa },
    201,
  );
});
