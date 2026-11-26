import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const QualificationSchema = z.object({
  matriculas_hoje: z.string().min(1),
  matriculas_antes_cnh_brasil: z.string().min(1),
  principal_fonte: z.string().min(1),
  investe_marketing: z.enum(["sim", "nao"]),
  maior_desafio: z.string().min(1),
  responsavel: z.string().min(1),
  nome_autoescola: z.string().min(1),
  cidade: z.string().min(1),
  socios: z.string().optional().default(""),
});

export type Qualification = z.infer<typeof QualificationSchema>;

async function generateCloserSummary(q: Qualification) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada");

  const system = `Você é um consultor de vendas B2B especialista em autoescolas.
A partir das respostas de qualificação do SDR, devolva JSON estritamente com o formato:
{
  "resumo": "um parágrafo objetivo (máx. 3 linhas) contextualizando a autoescola e a oportunidade",
  "dores": [{ "titulo": "curto", "descricao": "1-2 linhas", "severidade": "alta|media|baixa" }],
  "gancho_abertura": "frase entre aspas para iniciar a reunião, tom consultivo, cita 1 dor específica",
  "proximo_passo": "ação clara e específica do closer nesta reunião"
}
Devolva 3 a 4 dores. Não invente números. Use PT-BR.`;

  const user = `Respostas do SDR:
- Nome: ${q.nome_autoescola} (${q.cidade})
- Responsável: ${q.responsavel}
- Sócios: ${q.socios || "não informado"}
- Matrículas hoje: ${q.matriculas_hoje}
- Matrículas antes da CNH Brasil: ${q.matriculas_antes_cnh_brasil}
- Principal fonte de matrículas: ${q.principal_fonte}
- Investe em marketing digital: ${q.investe_marketing}
- Maior desafio: ${q.maior_desafio}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: 1500,
      system: system + "\nResponda somente com o objeto JSON, sem texto antes ou depois e sem bloco de código.",
      messages: [{ role: "user", content: user }],
    }),
  });
  if (res.status === 429) throw new Error("Muitas requisições à IA, tente novamente em instantes.");
  if (res.status === 401) throw new Error("ANTHROPIC_API_KEY inválida.");
  if (!res.ok) throw new Error(`Falha IA: ${res.status} ${await res.text()}`);
  const j = await res.json();
  const text: string = (j?.content ?? [])
    .filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("");
  // Corta qualquer texto em volta do objeto JSON.
  const ini = text.indexOf("{");
  const fim = text.lastIndexOf("}");
  const raw = ini >= 0 && fim > ini ? text.slice(ini, fim + 1) : "{}";
  try { return JSON.parse(raw); } catch { return { resumo: raw, dores: [], gancho_abertura: "", proximo_passo: "" }; }
}

export const saveQualification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      leadId: z.string().uuid(),
      qualification: QualificationSchema,
      meeting_at: z.string().nullable().optional(),
      meeting_link: z.string().optional().default(""),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const summary = await generateCloserSummary(data.qualification);

    const update: any = {
      sdr_qualification: data.qualification,
      closer_summary: summary,
      qualified_at: new Date().toISOString(),
      pipeline_stage: "scheduled",
      status: "meeting_scheduled",
      nome_fantasia: data.qualification.nome_autoescola,
      cidade: data.qualification.cidade,
      proprietario: data.qualification.responsavel,
    };
    if (data.meeting_at) {
      update.meeting_at = data.meeting_at;
      update.meeting_status = "scheduled";
    }
    if (data.meeting_link) update.meeting_link = data.meeting_link;

    const { error } = await supabase.from("leads").update(update).eq("id", data.leadId).eq("user_id", userId);
    if (error) throw error;
    return { ok: true, summary };
  });

export const regenerateCloserSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: lead, error } = await supabase.from("leads")
      .select("id, sdr_qualification").eq("id", data.leadId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!lead?.sdr_qualification) throw new Error("Lead sem qualificação preenchida");
    const parsed = QualificationSchema.parse(lead.sdr_qualification);
    const summary = await generateCloserSummary(parsed);
    await supabase.from("leads").update({ closer_summary: summary }).eq("id", lead.id);
    return { summary };
  });

export const updateMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      leadId: z.string().uuid(),
      meeting_status: z.enum(["scheduled", "held", "no_show", "rescheduled"]).optional(),
      meeting_result: z.enum(["won", "lost"]).nullable().optional(),
      meeting_at: z.string().nullable().optional(),
      meeting_link: z.string().optional(),
      closer_notes: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: any = {};
    for (const k of ["meeting_status", "meeting_result", "meeting_at", "meeting_link", "closer_notes"] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    if (data.meeting_result === "won") patch.pipeline_stage = "scheduled";
    const { error } = await supabase.from("leads").update(patch).eq("id", data.leadId).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const updateLeadStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      leadId: z.string().uuid(),
      pipeline_stage: z.enum(["activate", "in_contact", "scheduled", "dismissed"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("leads")
      .update({ pipeline_stage: data.pipeline_stage })
      .eq("id", data.leadId).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });