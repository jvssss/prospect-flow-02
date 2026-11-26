import { autenticar, autenticarCron, type Contexto } from "./auth.server";
import { erros } from "./errors";
import { json, paraResposta } from "./http";
import { consumir } from "./rate-limit";

type Entrada = { request: Request; params: Record<string, string> };
type Saida = Promise<Response>;

const LIMITE_POR_MINUTO = 240;

/** Rota autenticada (JWT ou chave de API) com limite de requisições. */
export function protegido(fn: (c: Contexto) => Saida, opcoes: { limitePorMinuto?: number } = {}) {
  return async ({ request, params }: Entrada): Saida => {
    try {
      const c = await autenticar(request, params);
      const limite = opcoes.limitePorMinuto ?? LIMITE_POR_MINUTO;
      const rl = consumir(`u:${c.userId}`, limite);
      if (!rl.ok) throw erros.limite(rl.retryAfter);
      const res = await fn(c);
      res.headers.set("x-ratelimit-limit", String(rl.limite));
      res.headers.set("x-ratelimit-remaining", String(rl.restante));
      return res;
    } catch (e) {
      return paraResposta(e);
    }
  };
}

/** Rota aberta (health, documentação). */
export function publico(fn: (e: Entrada) => Saida) {
  return async (e: Entrada): Saida => {
    try {
      return await fn(e);
    } catch (err) {
      return paraResposta(err);
    }
  };
}

/** Rota chamada por agendador, com segredo compartilhado. */
export function agendado(fn: (e: Entrada) => Saida) {
  return async (e: Entrada): Saida => {
    try {
      autenticarCron(e.request);
      return await fn(e);
    } catch (err) {
      return paraResposta(err);
    }
  };
}

export { json };
