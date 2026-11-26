# Prospect Flow API

API REST do painel de prospecção, dentro do próprio app (rotas de servidor do TanStack Start).
Documentação interativa: `GET /api/v1/docs`. Especificação OpenAPI: `GET /api/v1/openapi`.
Estado da instalação: `GET /api/health` (sem login; mostra o que falta configurar).

## O que ela resolve

- **QSA grátis e verificado.** Dono da autoescola vem da base da Receita Federal embutida no app
  (`public/rfb/<UF>.json`, sem limite de consulta). BrasilAPI, Minha Receita e open.cnpja entram só como reserva.
- **Verificação de verdade.** Cada resultado recebe uma nota de confiança (alta/média/baixa) a partir de
  nome, cidade, situação cadastral, telefone e existência de sócio pessoa física. Só confiança média ou alta vira dono do lead.
- **Automático.** O lead entra (Apify, importação ou API) e o QSA é verificado sozinho. A rotina `/api/cron/enrich`
  conclui jobs do Apify e processa o que ficou pendente. Você só olha o painel de leads.

## Instalação (uma vez)

1. **Migração.** Aplique `supabase/migrations/20261124190000_api_keys_and_indexes.sql` (cria `api_keys` e índices).
2. **Variáveis de ambiente** (veja `.env.example`):
   | Variável | Para quê |
   |---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | chaves de API e rotina automática |
   | `CRON_SECRET` | protege `/api/cron/enrich` (`openssl rand -hex 32`) |
   | `APIFY_TOKEN` | "Adquirir mais leads" por cidade |
3. **Base da Receita.** Os JSONs ficam em `public/rfb/`. Para atualizar (mensal):
   ```powershell
   npm run rfb:build -- 2026-12 .\rfb-download .\public\rfb
   ```
   Baixa os dados abertos da Receita, filtra o CNAE 8599-6/01 (formação de condutores) e grava um JSON por UF.
   Baixa ~7 GB, um arquivo por vez, e apaga cada um depois de filtrar.
4. **Agendador.** Chame a rotina a cada 5 minutos. Com `pg_cron` + `pg_net` no Supabase:
   ```sql
   select cron.schedule('prospect-flow-enrich', '*/5 * * * *', $$
     select net.http_post(
       url := 'https://SEU-APP/api/cron/enrich',
       headers := jsonb_build_object('Authorization', 'Bearer SEU_CRON_SECRET')
     );
   $$);
   ```

## Autenticação

- **Login do painel:** `Authorization: Bearer <jwt do Supabase>`.
- **Chave de API** (n8n, outros sistemas): `Authorization: Bearer pf_live_...` ou `x-api-key: pf_live_...`.
  Crie com `POST /api/v1/api-keys` (logado no painel). O valor aparece uma única vez; só o hash fica no banco.
  Uma chave de API não cria outras chaves.

Respostas: `{ "data": ..., "meta": ... }`. Erros: `{ "error": { "code", "message", "details?" } }`.
Limite: 240 requisições/min por usuário (cabeçalhos `x-ratelimit-*`).

## Receitas

```bash
# Criar leads (já verifica o QSA; ignora duplicados por CNPJ/telefone)
curl -X POST $APP/api/v1/leads -H "Authorization: Bearer $CHAVE" -H "content-type: application/json" \
  -d '{"leads":[{"nome_fantasia":"Auto Escola Fama","cidade":"Ipatinga","uf":"MG","telefone_1":"(31) 3822-1234"}]}'

# Ver o laudo de um lead
curl $APP/api/v1/leads/$ID/qsa -H "Authorization: Bearer $CHAVE"

# Reverificar sem gravar
curl -X POST "$APP/api/v1/leads/$ID/qsa?simular=true" -H "Authorization: Bearer $CHAVE"

# Descobrir empresa e decisor sem criar lead
curl -X POST $APP/api/v1/qsa/resolver -H "Authorization: Bearer $CHAVE" -H "content-type: application/json" \
  -d '{"nome_fantasia":"Auto Escola Fama","cidade":"Ipatinga","uf":"MG"}'

# Adquirir mais leads
curl -X POST $APP/api/v1/enrichment/jobs -H "Authorization: Bearer $CHAVE" -H "content-type: application/json" \
  -d '{"cidade":"Ipatinga, MG"}'

# Registrar ligação (mesmo efeito de clicar no Modo Foco)
curl -X POST $APP/api/v1/leads/$ID/calls -H "Authorization: Bearer $CHAVE" -H "content-type: application/json" \
  -d '{"outcome":"callback","return_at":"2026-11-26T14:00:00-03:00","nome_ponte":"Dona Cida"}'
```

## Como o QSA é verificado

1. CNPJ conhecido? Busca na base local; se não estiver, nas fontes gratuitas (com pausa automática da fonte que der 429).
2. Sem CNPJ: casa nome + cidade na base local (reaproveita `matchAutoescola`).
3. Último recurso: busca na web por "nome cidade CNPJ", e o CNPJ achado é conferido nas fontes gratuitas.
4. Nota de confiança: nome 40 + cidade 25 + empresa ativa 15 + telefone 10 + sócio pessoa física 10
   (telefone igual sustenta nome de fachada diferente). Cidade diferente limita a nota a 54; CNPJ inválido, a 10.
5. Decisor: sócio-administrador > administrador > diretor/presidente > titular > sócio. Sócios que são empresa são ignorados.

O laudo completo (verificações, alertas, fontes tentadas) fica em `leads.qsa`. Um `proprietario` digitado à mão
no Modo Foco nunca é sobrescrito.

## Limites conhecidos

- Os dados da Receita têm atraso (mensal). Atualize a base todo mês.
- Sócio pessoa física vem com CPF mascarado; o nome vem inteiro.
- Rate limit em memória por instância do Worker: segura laço de cliente, não abuso distribuído.
- A API filtra por `user_id` do autenticado. As políticas RLS atuais do projeto ("Shared all") continuam valendo para o painel.
