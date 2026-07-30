## Diagnóstico (verificado no banco e no código)

**1. Follow-ups não vêm primeiro em Ipatinga**
Ipatinga tem 120 leads, sendo 2 com `followup_at` preenchido (ambos com status elegível). Em `src/routes/_authenticated/cockpit.tsx` (linhas 159–195) a fila busca apenas **os 30 primeiros** leads ordenados por `last_call_at asc` e só depois ordena por prioridade **em memória**. Como os dois leads de follow-up já foram ligados (têm `last_call_at` recente), eles caem no fim da ordenação do banco e nunca entram nesse lote de 30 — logo, a priorização em memória nunca os enxerga.

**2. Observações da ligação somem / histórico da Noêmia vazio**
O `call_log` da Auto Escola Noêmia (hoje, 12:15:57) foi gravado com `notes = null` e `nome_ponte = null`. Causa: o `useEffect` da linha 300 tem como dependências `lead.nome_ponte`, `lead.proprietario`, `lead.followup_at`, `lead.followup_notes`. O enriquecimento JIT (linha 280–292) grava o lead atualizado no cache com `qc.setQueryData` — quando ele preenche `proprietario`, a dependência muda, o efeito roda de novo e executa `setCallNotes("")` / `setNomePonte(...)`, **apagando o que o SDR já tinha digitado**. Ao clicar no desfecho, os campos já estavam vazios → log sem observações.

**3. Efeito colateral encontrado**: o botão "Pular por agora" grava `last_call_at` sem criar `call_log`. Isso empurra leads nunca trabalhados para o fim da fila e explica dezenas de leads de Ipatinga com `last_call_at` de hoje e status `new`.

## O que mudar (apenas `src/routes/_authenticated/cockpit.tsx`)

### A. Fila: buscar follow-ups explicitamente
Trocar a busca única de 30 linhas por duas consultas paralelas, unidas antes da ordenação por prioridade:
1. **Prioritários**: leads da cidade com status elegível e (`followup_at not null` **ou** `retorno_agendado_em <= agora`), ordenados por essas datas asc, limite 50.
2. **Fila normal**: a consulta atual (limite 30).
Mesclar sem duplicar por `id`, aplicar a função de prioridade existente, filtrar `handledIds` e pegar o primeiro. Assim um follow-up sempre aparece antes, mesmo que a base tenha centenas de leads.

### B. Não apagar o que o usuário digitou
- Reduzir as dependências do `useEffect` de reset para **apenas `lead?.id`** (o pré-preenchimento continua lendo os campos do lead, mas só quando o lead realmente muda).
- No callback do JIT, ao fazer `setQueryData`, **preservar o lead em foco**: atualizar apenas campos de enriquecimento (`proprietario`, `socios`, `cnpj`, `capital_social`, `qsa`, `enrichment_status`, `opening_hours`, `email`, `website`) e nunca sobrescrever `nome_ponte` / `followup_*`.
- Como rede de segurança, em `logOutcome` ler os valores atuais dos inputs a partir de refs sincronizados com o state, evitando gravar `notes: null` caso algum re-render limpe o campo.

### C. Histórico visível após registrar o desfecho
- Depois de salvar, além de invalidar `["cockpit-lead-history", lead.id]`, invalidar também `["lead-call-history", lead.id]` (usado pelo diálogo do CRM) para a jornada do lead aparecer atualizada no card do CRM.
- Manter o card "Histórico deste lead" já existente; ele passará a mostrar corretamente as observações porque elas deixarão de ser apagadas.

### D. Pular sem sujar a fila
"Pular por agora" deixa de gravar `last_call_at` (que é reservado para ligações reais) e passa a apenas marcar o lead como tratado na sessão (`handledIds`) + refetch. Isso mantém a ordenação da fila coerente.

## Fora do escopo
- Nenhuma mudança de schema.
- Sem alterações no enriquecimento, CRM Kanban ou métricas diárias.

## Verificação
- Abrir Modo Foco em Ipatinga: o primeiro lead deve ser um dos 2 com follow-up marcado.
- Digitar "Nome da ponte" + observações num lead sem proprietário (que dispara o JIT) e aguardar o enriquecimento: os campos digitados devem permanecer.
- Clicar num desfecho e reabrir o lead pelo CRM: o `call_log` deve conter decisor + observações, e a aba Histórico deve mostrar a nova ligação.
