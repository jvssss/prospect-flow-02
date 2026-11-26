import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { protegido } from "../handler.server";
import { erros } from "../errors";
import { lerCorpo, lerQuery, ok } from "../http";
import { computeGoldenNumbers } from "@/lib/goldenMath";
import { metaDeLinha, somar, sugerirAjuste, type Totais } from "@/lib/metrics";
import { hojeSaoPaulo } from "./calls.server";

const sb = (c: { db: unknown }) => c.db as SupabaseClient;

async function metaAtiva(c: { db: unknown; userId: string }) {
  const { data, error } = await sb(c)
    .from("goals_math")
    .select("*")
    .eq("user_id", c.userId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw erros.interno(error.message);
  return data;
}

const taxa = z.number().gt(0).max(1);
const corpoMeta = z.object({
  monthly_revenue_target: z.number().nonnegative(),
  avg_ticket: z.number().positive(),
  prospecting_days_per_week: z.number().int().min(1).max(7),
  hours_per_day: z.number().positive().max(16),
  rate_call_to_decision: taxa,
  rate_decision_to_meeting: taxa,
  rate_show_up: taxa,
  rate_meeting_to_close: taxa,
});

/** GET /goals — meta ativa com os Números de Ouro já calculados. */
export const obterMeta = protegido(async (c) => {
  const g = await metaAtiva(c);
  if (!g) return ok(null, { aviso: "Nenhuma meta ativa. Use PUT /goals para criar." });
  return ok({ meta: g, numeros_de_ouro: computeGoldenNumbers(metaDeLinha(g)) });
});

/** PUT /goals — substitui a meta ativa (a anterior fica inativa, como histórico). */
export const salvarMeta = protegido(async (c) => {
  const b = await lerCorpo(c.request, corpoMeta);
  const atual = await metaAtiva(c);
  const { data, error } = atual
    ? await sb(c).from("goals_math").update(b).eq("id", atual.id).select("*").single()
    : await sb(c).from("goals_math").insert({ ...b, user_id: c.userId, is_active: true }).select("*").single();
  if (error) throw erros.interno(error.message);
  return ok({ meta: data, numeros_de_ouro: computeGoldenNumbers(metaDeLinha(data)) });
});

const consultaPeriodo = z.object({
  de: z.string().date().optional(),
  ate: z.string().date().optional(),
  dias: z.coerce.number().int().min(1).max(365).default(30),
});

function periodo(q: z.infer<typeof consultaPeriodo>) {
  const ate = q.ate ?? hojeSaoPaulo();
  const de = q.de ?? new Date(new Date(`${ate}T12:00:00Z`).getTime() - (q.dias - 1) * 86_400_000).toISOString().slice(0, 10);
  if (de > ate) throw erros.invalido("`de` não pode ser depois de `ate`.");
  return { de, ate };
}

async function linhasDoPeriodo(c: { db: unknown; userId: string }, de: string, ate: string) {
  const { data, error } = await sb(c)
    .from("daily_metrics")
    .select("*")
    .eq("user_id", c.userId)
    .gte("day", de)
    .lte("day", ate)
    .order("day", { ascending: true });
  if (error) throw erros.interno(error.message);
  return data ?? [];
}

const razao = (n: number, d: number) => (d > 0 ? n / d : null);

/** GET /metrics — dias do período, totais e taxas reais do funil. */
export const metricas = protegido(async (c) => {
  const { de, ate } = periodo(lerQuery(c.request, consultaPeriodo));
  const linhas = await linhasDoPeriodo(c, de, ate);
  const t = somar(linhas);
  return ok(
    {
      dias: linhas,
      totais: t,
      taxas_reais: {
        ligacao_decisor: razao(t.decisions_reached, t.calls_made),
        decisor_reuniao: razao(t.meetings_scheduled, t.decisions_reached),
        show_up: razao(t.meetings_held, t.meetings_scheduled),
        reuniao_fechamento: razao(t.closes, t.meetings_held),
      },
    },
    { de, ate },
  );
});

/** GET /metrics/hoje — progresso do dia contra a meta diária. */
export const metricasHoje = protegido(async (c) => {
  const dia = hojeSaoPaulo();
  const [g, linhas] = await Promise.all([metaAtiva(c), linhasDoPeriodo(c, dia, dia)]);
  const hoje: Totais = somar(linhas);
  if (!g) return ok({ dia, hoje, meta_diaria: null, progresso: null });
  const ouro = computeGoldenNumbers(metaDeLinha(g));
  const alvo = ouro.daily.calls;
  const restantes = Math.max(0, alvo - hoje.calls_made);
  return ok({
    dia,
    hoje,
    meta_diaria: ouro.daily,
    progresso: {
      percentual: alvo > 0 ? Math.min(100, Math.round((hoje.calls_made / alvo) * 100)) : 0,
      ligacoes_restantes: restantes,
      segundos_por_ligacao: ouro.daily.secondsPerCall,
    },
  });
});

/**
 * GET /metrics/sugestao — compara as taxas estimadas com as reais e propõe a nova
 * meta diária. Etapas com pouca amostra mantêm a taxa estimada, para uma
 * semana ruim não desmontar a meta.
 */
export const sugestao = protegido(async (c) => {
  const q = lerQuery(c.request, consultaPeriodo);
  const { de, ate } = periodo(q);
  const [g, linhas] = await Promise.all([metaAtiva(c), linhasDoPeriodo(c, de, ate)]);
  if (!g) throw erros.invalido("Crie uma meta (PUT /goals) antes de pedir sugestão.");
  return ok(sugerirAjuste(metaDeLinha(g), somar(linhas)), { de, ate });
});

const corpoAplicar = z.object({ de: z.string().date().optional(), ate: z.string().date().optional(), dias: z.number().int().min(1).max(365).default(30) });

/** POST /metrics/sugestao/aplicar — grava na meta as taxas sugeridas. */
export const aplicarSugestao = protegido(async (c) => {
  const b = await lerCorpo(c.request, corpoAplicar);
  const { de, ate } = periodo({ ...b, dias: b.dias });
  const [g, linhas] = await Promise.all([metaAtiva(c), linhasDoPeriodo(c, de, ate)]);
  if (!g) throw erros.invalido("Nenhuma meta ativa.");
  const s = sugerirAjuste(metaDeLinha(g), somar(linhas));
  if (!s.recomendar) return ok(s, { aplicado: false });
  const por = Object.fromEntries(s.etapas.map((e) => [e.etapa, Number(e.sugerido.toFixed(4))]));
  const { error } = await sb(c)
    .from("goals_math")
    .update({
      rate_call_to_decision: por.ligacao_decisor,
      rate_decision_to_meeting: por.decisor_reuniao,
      rate_show_up: por.show_up,
      rate_meeting_to_close: por.reuniao_fechamento,
    })
    .eq("id", g.id);
  if (error) throw erros.interno(error.message);
  return ok(s, { aplicado: true });
});
