/**
 * Especificação OpenAPI 3.1 da API. Fica em código (não em arquivo) para sempre
 * sair junto com o deploy e usar a origem real da requisição.
 */
type Params = Record<string, unknown>[];

const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const pg: Params = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
];
const q = (name: string, description: string, schema: Record<string, unknown> = { type: "string" }) => ({
  name,
  in: "query",
  description,
  schema,
});

const resp = (descricao: string, status = "200") => ({
  [status]: { description: descricao, content: { "application/json": { schema: { $ref: "#/components/schemas/Resposta" } } } },
  "401": { $ref: "#/components/responses/NaoAutenticado" },
  "422": { $ref: "#/components/responses/Invalido" },
});

const op = (tag: string, summary: string, extra: Record<string, unknown> = {}, status = "200") => ({
  tags: [tag],
  summary,
  security: [{ bearerAuth: [] }, { apiKey: [] }],
  responses: resp("Sucesso", status),
  ...extra,
});

const corpo = (ref: string) => ({
  requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } },
});

export function openapi(origem: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Prospect Flow API",
      version: "1.0.0",
      description:
        "API do painel de prospecção. Autentique com o login do painel (`Authorization: Bearer <jwt>`) ou com uma chave de API (`Authorization: Bearer pf_live_...` ou `x-api-key`). " +
        "O QSA é verificado só com fontes gratuitas: base local da Receita Federal e, como reserva, BrasilAPI, Minha Receita e open.cnpja.",
    },
    servers: [{ url: origem }],
    tags: [
      { name: "Leads" },
      { name: "QSA" },
      { name: "Ligações" },
      { name: "Fila" },
      { name: "Metas e métricas" },
      { name: "Enriquecimento" },
      { name: "Conta" },
      { name: "Sistema" },
    ],
    paths: {
      "/api/health": { get: { tags: ["Sistema"], summary: "Estado da instalação (sem autenticação)", responses: { "200": { description: "OK" } } } },
      "/api/v1/me": { get: op("Conta", "Quem está autenticado") },
      "/api/v1/api-keys": {
        get: op("Conta", "Lista chaves de API (sem o valor)"),
        post: op("Conta", "Cria uma chave de API (valor mostrado uma única vez; exige login do painel)", corpo("NovaChave"), "201"),
      },
      "/api/v1/api-keys/{id}": { delete: op("Conta", "Revoga uma chave", { parameters: [idParam] }) },

      "/api/v1/leads": {
        get: op("Leads", "Lista leads com filtros e paginação", {
          parameters: [
            ...pg,
            q("q", "Busca em nome, razão social, sócio, CNPJ, telefone e bairro"),
            q("cidade", "Cidade (sem diferenciar maiúsculas)"),
            q("uf", "UF"),
            q("status", "Um ou mais status, separados por vírgula: new,no_answer,gatekeeper,callback,not_interested,meeting_scheduled"),
            q("etapa", "pipeline_stage: activate,in_contact,scheduled,dismissed"),
            q("enriquecimento", "pendente,retry,enriched,inactive,not_found (vírgula)"),
            q("com_decisor", "true = só leads com proprietário identificado", { type: "boolean" }),
            q("com_telefone", "true = só leads com telefone", { type: "boolean" }),
            q("com_followup", "true = só leads com follow-up marcado", { type: "boolean" }),
            q("retorno_vencido", "true = retorno agendado já vencido", { type: "boolean" }),
            q("ordem", "created_at | updated_at | last_call_at | nome_fantasia | followup_at"),
            q("direcao", "asc | desc"),
          ],
        }),
        post: op(
          "Leads",
          "Cria um lead ou um lote (até 500). Ignora duplicados por CNPJ/telefone e, por padrão, já verifica o QSA.",
          corpo("CriarLeads"),
          "201",
        ),
      },
      "/api/v1/leads/{id}": {
        get: op("Leads", "Obtém um lead", { parameters: [idParam] }),
        patch: op("Leads", "Atualiza campos do lead", { parameters: [idParam], ...corpo("AtualizarLead") }),
        delete: op("Leads", "Exclui o lead (o histórico de ligações permanece)", { parameters: [idParam] }),
      },
      "/api/v1/leads/{id}/qsa": {
        get: op("QSA", "Laudo de verificação já gravado no lead", { parameters: [idParam] }),
        post: op("QSA", "Verifica (ou reverifica) o QSA e grava. `?simular=true` não grava; `?web=false` desliga a busca na web.", {
          parameters: [idParam, q("simular", "true = só mostra", { type: "boolean" }), q("web", "false = não usar busca na web", { type: "boolean" })],
        }),
      },
      "/api/v1/leads/{id}/calls": {
        get: op("Ligações", "Histórico de ligações do lead", { parameters: [idParam, ...pg] }),
        post: op(
          "Ligações",
          "Registra uma ligação: atualiza lead, cadência, histórico e métricas do dia (igual ao Modo Foco)",
          { parameters: [idParam], ...corpo("RegistrarLigacao") },
          "201",
        ),
      },
      "/api/v1/qsa/{cnpj}": {
        get: op("QSA", "Consulta livre de um CNPJ: empresa, sócios, decisor e nota de confiança", {
          parameters: [
            { name: "cnpj", in: "path", required: true, schema: { type: "string" } },
            q("uf", "UF, acelera a busca na base local"),
            q("nome", "Nome do lead, para calcular a confiança"),
            q("cidade", "Cidade do lead, para calcular a confiança"),
          ],
        }),
      },
      "/api/v1/qsa/resolver": { post: op("QSA", "Descobre empresa e decisor por nome + cidade + UF", corpo("ResolverQsa")) },

      "/api/v1/queue": {
        get: op("Fila", "Fila do Modo Foco: follow-ups, retornos vencidos, nunca ligados, resto", {
          parameters: [q("cidade", "Obrigatório"), q("limit", "até 100", { type: "integer" }), q("excluir", "IDs já tratados, separados por vírgula")],
        }),
      },
      "/api/v1/queue/cities": { get: op("Fila", "Cidades com leads e quantos estão na fila") },

      "/api/v1/goals": {
        get: op("Metas e métricas", "Meta ativa e Números de Ouro calculados"),
        put: op("Metas e métricas", "Cria/atualiza a meta ativa", corpo("Meta")),
      },
      "/api/v1/metrics": { get: op("Metas e métricas", "Métricas por dia, totais e taxas reais do funil", { parameters: [q("de", "AAAA-MM-DD"), q("ate", "AAAA-MM-DD"), q("dias", "Últimos N dias (padrão 30)", { type: "integer" })] }) },
      "/api/v1/metrics/today": { get: op("Metas e métricas", "Progresso de hoje contra a meta diária") },
      "/api/v1/metrics/suggestion": { get: op("Metas e métricas", "Compara taxas estimadas e reais e sugere nova meta diária") },
      "/api/v1/metrics/suggestion/apply": { post: op("Metas e métricas", "Grava na meta as taxas sugeridas") },

      "/api/v1/enrichment/jobs": {
        get: op("Enriquecimento", "Jobs de busca por cidade"),
        post: op("Enriquecimento", "Adquirir mais leads: busca no Google Maps pela cidade", corpo("NovoJob"), "202"),
      },
      "/api/v1/enrichment/jobs/{id}": {
        get: op("Enriquecimento", "Acompanha o job; ao terminar, cria os leads e já verifica o QSA", { parameters: [idParam] }),
      },
      "/api/v1/enrichment/qsa": { post: op("Enriquecimento", "Verifica o QSA dos leads pendentes (repita enquanto `restantes` > 0)") },
      "/api/v1/enrichment/stats": { get: op("Enriquecimento", "Quantos leads em cada situação de verificação") },

      "/api/cron/enrich": {
        post: {
          tags: ["Sistema"],
          summary: "Rotina automática (agendador). Autentica com CRON_SECRET.",
          security: [{ cronSecret: [] }],
          responses: { "200": { description: "OK" } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "JWT do painel ou chave `pf_live_...`" },
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
        cronSecret: { type: "http", scheme: "bearer", description: "Valor de CRON_SECRET" },
      },
      responses: {
        NaoAutenticado: { description: "Credenciais ausentes ou inválidas", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
        Invalido: { description: "Dados inválidos", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } },
      },
      schemas: {
        Resposta: { type: "object", properties: { data: {}, meta: { type: "object" } } },
        Erro: {
          type: "object",
          properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } },
        },
        NovaChave: { type: "object", required: ["nome"], properties: { nome: { type: "string", minLength: 2, maxLength: 60 } } },
        Lead: {
          type: "object",
          required: ["nome_fantasia"],
          properties: {
            nome_fantasia: { type: "string" }, razao_social: { type: "string" }, telefone_1: { type: "string" }, telefone_2: { type: "string" },
            whatsapp: { type: "string" }, cidade: { type: "string" }, uf: { type: "string", example: "MG" }, bairro: { type: "string" },
            endereco: { type: "string" }, website: { type: "string" }, email: { type: "string", format: "email" },
            cnpj: { type: "string", description: "Só dígitos ou formatado; os dígitos verificadores são conferidos" },
            capital_social: { type: "number" }, data_abertura: { type: "string", format: "date" }, proprietario: { type: "string" }, notas: { type: "string" },
            source: { type: "string", default: "api" },
          },
        },
        CriarLeads: {
          oneOf: [
            { allOf: [{ $ref: "#/components/schemas/Lead" }, { type: "object", properties: { enriquecer: { type: "boolean", default: true } } }] },
            { type: "object", required: ["leads"], properties: { leads: { type: "array", maxItems: 500, items: { $ref: "#/components/schemas/Lead" } }, enriquecer: { type: "boolean", default: true } } },
          ],
        },
        AtualizarLead: { type: "object", description: "Qualquer campo de Lead, mais status, pipeline_stage, nome_ponte, followup_at, followup_notes, retorno_agendado_em, meeting_*", additionalProperties: true },
        RegistrarLigacao: {
          type: "object",
          required: ["outcome"],
          properties: {
            outcome: { type: "string", enum: ["no_answer", "gatekeeper", "not_interested", "callback", "meeting_scheduled"] },
            duration_seconds: { type: "integer" }, nome_ponte: { type: "string" }, nome_decisor: { type: "string" }, notes: { type: "string" },
            return_at: { type: "string", format: "date-time", description: "Retorno (callback) ou reunião (meeting_scheduled)" },
            followup_at: { type: "string", format: "date-time" }, followup_notes: { type: "string" },
          },
        },
        ResolverQsa: {
          type: "object",
          required: ["nome_fantasia", "cidade", "uf"],
          properties: { nome_fantasia: { type: "string" }, cidade: { type: "string" }, uf: { type: "string" }, telefone: { type: "string" }, busca_web: { type: "boolean", default: true } },
        },
        NovoJob: {
          type: "object",
          required: ["cidade"],
          properties: { cidade: { type: "string", example: "Ipatinga, MG" }, nicho: { type: "string", default: "Autoescola" }, maximo: { type: "integer", default: 40, minimum: 5, maximum: 200 } },
        },
        Meta: {
          type: "object",
          required: ["monthly_revenue_target", "avg_ticket", "prospecting_days_per_week", "hours_per_day", "rate_call_to_decision", "rate_decision_to_meeting", "rate_show_up", "rate_meeting_to_close"],
          properties: {
            monthly_revenue_target: { type: "number" }, avg_ticket: { type: "number" }, prospecting_days_per_week: { type: "integer" }, hours_per_day: { type: "number" },
            rate_call_to_decision: { type: "number", description: "0 a 1" }, rate_decision_to_meeting: { type: "number" }, rate_show_up: { type: "number" }, rate_meeting_to_close: { type: "number" },
          },
        },
      },
    },
  };
}
