## Problema

No Cockpit, o lead atual "troca sozinho" enquanto o SDR está preenchendo os campos (nome do decisor, ponte, observações). Quando isso acontece, ao clicar no desfecho da ligação as observações vão para o lead errado (ou são resetadas pelo `useEffect` de mudança de lead), dando a impressão de que "não salvou".

## Causa raiz

Dois fatores combinados em `src/routes/_authenticated/cockpit.tsx`:

1. **Ordenação instável da fila.** A query `cockpit-queue` ordena só por `last_call_at asc nullsFirst` e faz `limit(1)`. Vários leads têm `last_call_at = null`, e o Postgres não garante ordem entre nulls — cada `refetch` pode retornar um lead diferente como "o primeiro".
2. **JIT de enriquecimento chama `refetchQueue()` sempre.** Quando o lead atual não tem proprietário/sócios, o cockpit dispara `enrichLeadOnDemand` e, no `.then/.finally`, refaz a query. Como a ordenação não é estável, o "primeiro" muda → o `useEffect([lead?.id])` limpa `nomePonte / nomeDecisor / callNotes / returnAt / followupAt / followupNotes` no meio da digitação. Se a API CNPJá não encontra, o mesmo refetch acontece e ainda por cima o lead pode cair para o fim da fila em refetches futuros.

Ou seja: não é o desfecho que está pulando — é a fila que se reembaralha por causa do JIT + ordenação sem desempate.

## Correção

Ficar tudo em `src/routes/_authenticated/cockpit.tsx` (nenhuma mudança de backend nem de schema).

1. **Fila estável**: adicionar desempate determinístico na query `cockpit-queue`:
   ```
   .order("last_call_at", { ascending: true, nullsFirst: true })
   .order("id", { ascending: true })
   ```
   Assim, entre leads com `last_call_at = null`, sempre volta o mesmo primeiro até ele receber um desfecho.

2. **JIT não refaz a fila**: substituir o `refetchQueue()` do `.then` do `enrichLeadOnDemand` por uma atualização in-place do cache — buscar só a linha desse `lead.id` e usar `qc.setQueryData(["cockpit-queue", city], (old) => old?.map(l => l.id === lead.id ? merged : l))`. Se a API não encontrar (throw ou `not_found`), não faz nada: o lead permanece exibido, o usuário continua digitando e decide o desfecho manualmente. Nada de auto-skip.

3. **Preservar campos digitados**: o `useEffect` que reseta os campos deve continuar disparando só em troca real de lead. Com (1) e (2), `lead?.id` não muda mais sozinho, então os campos deixam de ser apagados.

4. **Salvar sempre observação, mesmo sem decisor**: revisar o `logOutcome` para garantir que `callNotes` vai para `call_logs.notes` mesmo quando `nomeDecisor` está vazio (hoje já vai, mas confirmar o join com `.filter(Boolean).join(" · ")` — manter e cobrir o caso `callNotes` sozinho).

## Verificação

- Selecionar cidade com leads sem proprietário → confirmar no console/network que o JIT roda uma vez e o `lead.id` exibido não muda.
- Digitar "Nome do decisor" e "Observações", clicar em cada desfecho (1–5) e conferir em `call_logs` (via read query) que `notes` e demais campos foram gravados para o `lead_id` correto.
- Forçar um lead cujo CNPJ a API não acha → confirmar que continua exibido e não pula até o usuário escolher o desfecho.
