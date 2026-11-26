# Entrega: API e automação do QSA

Este documento é para quem vai publicar e operar o projeto. Para uso diário da API, veja `docs/API.md`.

## O que foi adicionado

1. **QSA (quadro societário) gratuito e verificado.** O dono da autoescola é buscado na base da Receita Federal
   embutida no app, sem custo e sem limite de consulta. BrasilAPI, Minha Receita e open.cnpja entram só como reserva.
   Cada resultado recebe uma nota de confiança (alta, média ou baixa). Só média ou alta vira dono do lead.
2. **Automação.** Todo lead novo (busca por cidade, importação ou API) já tem o QSA verificado. Uma rotina agendada
   conclui as buscas do Apify e processa o que ficou pendente. No painel de leads não é preciso clicar em nada.
3. **API REST** (`/api/v1/...`) para integrar com n8n, WhatsApp e outros sistemas: leads, ligações, fila do Modo Foco,
   metas, métricas, enriquecimento e chaves de API. Documentação interativa em `/api/v1/docs`.

O painel atual não foi alterado. O fluxo antigo de enriquecimento (CNPJá paga) continua existindo, mas não é mais necessário.

## O que o cliente precisa fazer (uma vez)

### 1. Aplicar a migração no Supabase
Arquivo: `supabase/migrations/20261124190000_api_keys_and_indexes.sql`.
Cria a tabela de chaves de API e índices. Não altera dados existentes.

### 2. Configurar variáveis de ambiente
Modelo em `.env.example`.

| Variável | Obrigatória | Para quê |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | sim | chaves de API e rotina automática (Supabase > Settings > API > `service_role`) |
| `CRON_SECRET` | sim | protege a rotina automática; gere um valor longo e aleatório |
| `APIFY_TOKEN` | para "Adquirir mais leads" | busca de autoescolas no Google Maps por cidade |

**Segurança:** a `service_role` dá acesso total ao banco. Nunca coloque no navegador nem em repositório público.

### 3. Agendar a rotina automática
Chamar `POST https://SEU-APP/api/cron/enrich` a cada 5 minutos, com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.
Exemplo pronto com `pg_cron` do Supabase em `docs/API.md`.

### 4. Conferir a instalação
Abrir `https://SEU-APP/api/health`. A página lista o que ainda falta configurar e se a base da Receita foi encontrada.
O status deve estar `ok`.

## Base da Receita (atualização mensal)

Os arquivos ficam em `public/rfb/` (um por estado, 10 MB no total). A entrega já traz a base de **2026-11**:
20.275 autoescolas (CNAE 8599-6/01 principal, ativas, suspensas ou inaptas) em 27 estados. Autoescolas cadastradas
com outro CNAE principal não aparecem; nesse caso o QSA cai nas fontes gratuitas externas. Os dados da Receita são atualizados todo mês.
Para atualizar, em uma máquina com Python 3 e cerca de 10 GB livres:

```powershell
npm run rfb:build -- 2026-12 .\rfb-download .\public\rfb
```

Troque `2026-12` pelo mês mais recente disponível. O processo baixa os arquivos da Receita (cerca de 7 GB,
um por vez, apagando cada um depois de filtrar) e leva em torno de 30 a 60 minutos. Depois, publique o app de novo.

## Como o QSA é decidido (para explicar ao time)

- A nota soma evidências: nome parecido (40), mesma cidade (25), empresa ativa (15), telefone igual (10), sócio pessoa física (10).
- Cidade diferente limita a nota; CNPJ inválido a derruba. Empresa baixada ou inapta gera alerta.
- O decisor é escolhido por cargo: sócio-administrador, depois administrador, diretor, titular, sócio.
- O laudo completo (o que foi checado, alertas, fontes tentadas) fica salvo em `leads.qsa`.
- Se o SDR digitar o decisor no Modo Foco, o sistema nunca sobrescreve.

## Limites conhecidos

- A Receita publica os dados com atraso (mensal). Empresas muito novas podem não aparecer.
- Sócios pessoa física vêm com CPF mascarado; o nome vem completo.
- O limite de requisições da API é por instância (segura laço de cliente, não abuso distribuído).
- A API mostra só os leads do usuário autenticado. As políticas atuais do banco ("Shared all") deixam o painel
  ver os leads de todos; se a equipe compartilha leads, isso precisa ser alinhado.
- O código usa colunas que as migrações do repositório não criam (`cadencia_*`, tabela `disparos`, `google_meu_negocio`).
  Elas já existem no banco do projeto; um banco novo montado só pelas migrações do repositório não as terá.

## Como foi validado

- 45 testes automatizados (`npm test`), verificação de tipos limpa (`npm run typecheck`) e build de produção (`npm run build`).
- As rotas da API respondem corretamente sem autenticação (401/503) em servidor local.
- **Não foi testado contra o banco real do cliente.** Recomenda-se um teste de fumaça após publicar: criar uma chave de API,
  criar um lead e conferir o laudo em `GET /api/v1/leads/{id}/qsa`.
