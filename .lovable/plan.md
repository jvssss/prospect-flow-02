## Diagnóstico (verificado no código)

Em `src/routes/_authenticated/cockpit.tsx > logOutcome` (linhas 209–271), ao clicar num desfecho o app **já salva tudo**:

- `call_logs` recebe `outcome`, `duration_seconds`, `nome_ponte`, `scheduled_return_at` e `notes` (formato `Decisor: X · <observações>`).
- `leads` recebe `status`, `pipeline_stage`, `last_call_at`, e — quando preenchidos — `nome_ponte`, `proprietario` (nome do decisor), `retorno_agendado_em`, `meeting_at`, `followup_at`, `followup_notes`.

O que dá a sensação de "não salvou" é que, logo depois, o `refetchQueue()` puxa o **próximo lead** e o `useEffect([lead?.id])` (linha 204) zera os campos. Os dados estão no banco — só não voltam a aparecer na tela.

E hoje, se você voltar ao mesmo lead depois, **nada é pré-carregado** nem exibido: os inputs iniciam vazios e não há histórico visível.

## O que mudar (só `src/routes/_authenticated/cockpit.tsx`)

1. **Buscar histórico do lead atual** com uma nova query `["cockpit-lead-history", lead.id]`:
   - `call_logs` do `lead_id`, ordenado por `created_at desc`, limit 5 — para mostrar histórico e pegar o último desfecho.
   - Reaproveitar `lead.nome_ponte`, `lead.proprietario`, `lead.followup_notes`, `lead.followup_at`, `lead.retorno_agendado_em` que já vêm na query da fila.

2. **Novo card "Histórico deste lead"** na coluna direita, acima do bloco de desfechos:
   - Último desfecho (label + ícone + quando, ex.: "Ponte / Secretária · há 2 dias").
   - Última observação salva (`notes` do call_log mais recente).
   - Contador: "N ligações registradas".
   - Lista compacta das últimas 3–5 tentativas (data + desfecho + trecho da nota).
   - Se nunca houve ligação: "Primeiro contato com este lead."

3. **Pré-preencher os inputs ao carregar o lead** (ajustar o `useEffect` da linha 204):
   - `nomePonte` ← `lead.nome_ponte ?? ""`
   - `nomeDecisor` ← `lead.proprietario ?? ""` (só quando não veio de sócio/QSA — hoje `proprietario` é usado como decisor manual)
   - `followupAt` ← `lead.followup_at` formatado para `datetime-local` (se houver)
   - `followupNotes` ← `lead.followup_notes ?? ""`
   - `callNotes` continua **vazio** (cada ligação = observação nova; a anterior fica visível no card de histórico).
   - `returnAt` continua vazio (agendamento é decisão da nova ligação).

4. **Após salvar desfecho**: invalidar também `["cockpit-lead-history", lead.id]` para o próximo lead já vir com seu próprio histórico atualizado.

## Fora do escopo

- Nenhuma mudança de schema (colunas `nome_ponte`, `followup_at`, `followup_notes`, `retorno_agendado_em` já existem em `leads`; `call_logs.notes` já guarda decisor+observações).
- Sem mexer em CRM, enriquecimento, fila ou métricas diárias.

## Verificação

- Preencher ponte + observações, clicar em desfecho → conferir toast e que o lead sai da fila.
- Voltar ao mesmo lead (mudar cidade e voltar, ou reabrir depois): os campos "Nome da ponte" e "Nome do decisor" devem vir preenchidos; o card de histórico deve mostrar o último desfecho + observação salva.
- Rodar 2 ligações no mesmo lead (ex.: "Não atendeu" → depois "Ponte"): a segunda vez deve mostrar a primeira no histórico.
