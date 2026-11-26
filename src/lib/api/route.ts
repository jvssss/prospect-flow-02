import { CORS_HEADERS } from "./http";

/**
 * Cola entre o arquivo de rota (que vai para o bundle do cliente) e os handlers
 * (que usam chave de serviço e só podem existir no servidor). O `import()`
 * dinâmico mantém o código do servidor fora do bundle do navegador.
 */
type Ctx = { request: Request; params: Record<string, string> };
type Handler = (ctx: Ctx) => Promise<Response>;
type Metodo = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function apiHandlers(
  carregar: () => Promise<object>,
  mapa: Partial<Record<Metodo, string>>,
) {
  const h: Record<string, (ctx: any) => Promise<Response> | Response> = {
    OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
  for (const [metodo, nome] of Object.entries(mapa)) {
    h[metodo] = async (ctx: Ctx) => {
      const mod = (await carregar()) as Record<string, Handler>;
      return mod[nome]({ request: ctx.request, params: ctx.params ?? {} });
    };
  }
  return h;
}
