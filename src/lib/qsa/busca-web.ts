import { cnpjValido } from "./verify";

/**
 * Último recurso gratuito para descobrir o CNPJ: procura "{nome} {cidade} CNPJ"
 * no DuckDuckGo (versão HTML) e pega o primeiro número que passa na validação
 * dos dígitos verificadores.
 *
 * É frágil por natureza (o buscador pode bloquear), por isso o resultado nunca é
 * aceito às cegas: `resolverQsa` confere cidade e nome contra a Receita.
 */
const CNPJ_REGEX = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export async function buscarCnpjPorTexto(
  nome: string,
  cidade: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!nome) return null;
  const q = `${nome} ${cidade ?? ""} CNPJ`.trim();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    for (const m of html.match(CNPJ_REGEX) ?? []) {
      const d = m.replace(/\D/g, "");
      if (cnpjValido(d)) return d;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
