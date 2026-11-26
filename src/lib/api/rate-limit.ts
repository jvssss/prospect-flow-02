/**
 * Janela deslizante em memória, por processo.
 *
 * Em Worker cada instância tem o seu contador, então o limite real é "por
 * instância". Serve para segurar um laço descontrolado num cliente, não como
 * proteção contra abuso distribuído (para isso, use as regras do Cloudflare).
 */
const janelas = new Map<string, number[]>();

export function consumir(
  chave: string,
  limite: number,
  janelaMs = 60_000,
  agora = Date.now(),
): { ok: true; restante: number; limite: number } | { ok: false; retryAfter: number; limite: number } {
  const desde = agora - janelaMs;
  const lista = (janelas.get(chave) ?? []).filter((t) => t > desde);
  if (lista.length >= limite) {
    janelas.set(chave, lista);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((lista[0] + janelaMs - agora) / 1000)), limite };
  }
  lista.push(agora);
  janelas.set(chave, lista);
  // Evita crescer sem fim com chaves que nunca mais voltam.
  if (janelas.size > 5000) {
    for (const [k, v] of janelas) if (!v.length || v[v.length - 1] <= desde) janelas.delete(k);
  }
  return { ok: true, restante: limite - lista.length, limite };
}

export function zerarLimites() {
  janelas.clear();
}
