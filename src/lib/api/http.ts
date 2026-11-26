import { z } from "zod";
import { ApiError, erros } from "./errors";

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-api-key,x-cron-secret",
  "access-control-max-age": "86400",
};

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS_HEADERS, ...init.headers },
  });
}

export function ok<T>(data: T, meta?: Record<string, unknown>, status = 200): Response {
  return json(meta ? { data, meta } : { data }, { status });
}

export function paraResposta(e: unknown): Response {
  if (e instanceof ApiError) {
    return json(
      { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } },
      { status: e.status },
    );
  }
  if (e instanceof z.ZodError) {
    return json(
      {
        error: {
          code: "validation_error",
          message: "Dados inválidos.",
          details: e.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })),
        },
      },
      { status: 422 },
    );
  }
  console.error("[api] erro não tratado", e);
  return json({ error: { code: "internal_error", message: "Erro interno." } }, { status: 500 });
}

export async function lerCorpo<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  let bruto: unknown;
  try {
    const txt = await request.text();
    bruto = txt ? JSON.parse(txt) : {};
  } catch {
    throw erros.invalido("O corpo da requisição não é um JSON válido.");
  }
  return schema.parse(bruto);
}

export function lerQuery<T extends z.ZodTypeAny>(request: Request, schema: T): z.infer<T> {
  const obj: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  return schema.parse(obj);
}

/** Coerções seguras para query string. */
export const qInt = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);
export const qBool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1")
  .optional();

export const paginacao = z.object({
  limit: qInt(50, 1, 200),
  page: qInt(1, 1, 100000),
});

export function metaPaginacao(total: number | null, limit: number, page: number) {
  return {
    total: total ?? undefined,
    page,
    limit,
    pages: total != null ? Math.max(1, Math.ceil(total / limit)) : undefined,
  };
}

/**
 * Prepara texto de usuário para ilike/or() do PostgREST: remove vírgula e
 * parênteses (que quebram a sintaxe de `or(...)`) e escapa os curingas do LIKE.
 */
export function likeSeguro(s: string): string {
  return s
    .replace(/[,()]/g, " ")
    .replace(/[%_\\]/g, (c) => "\\" + c)
    .trim();
}
