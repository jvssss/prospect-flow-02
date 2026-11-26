export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const erros = {
  naoAutenticado: (msg = "Credenciais ausentes ou inválidas.") => new ApiError(401, "unauthorized", msg),
  proibido: (msg = "Sem permissão para este recurso.") => new ApiError(403, "forbidden", msg),
  naoEncontrado: (what = "Recurso") => new ApiError(404, "not_found", `${what} não encontrado.`),
  invalido: (msg: string, details?: unknown) => new ApiError(422, "validation_error", msg, details),
  conflito: (msg: string) => new ApiError(409, "conflict", msg),
  limite: (retryAfter: number) =>
    new ApiError(429, "rate_limited", `Muitas requisições. Tente de novo em ${retryAfter}s.`, { retry_after: retryAfter }),
  config: (msg: string) => new ApiError(503, "not_configured", msg),
  interno: (msg = "Erro interno.") => new ApiError(500, "internal_error", msg),
};
