# Math Mastery CRM

Atue como um Product Manager (PM) Senior de SaaS B2B, Engenheiro de Software Full-Stack e Especialista em Estratégia de Vendas Outbound/CRM.

Preciso da especificação técnica, arquitetura de software, estrutura de banco de dados e proposta de UI/UX para um SaaS de prospecção focado em alta produtividade e execução disciplinada, baseado na metodologia de "Matemática do Faturamento" (Marcus Vinícius).

O objetivo do sistema não é ser um CRM complexo e lento, mas sim uma ferramenta ultra-ágil para SDRs/BDRs baterem metas com clareza matemática e ritmo acelerado (60 a 65 ligações em 1h30 a 2h).

### MÓDULOS E FUNCIONALIDADES DA APLICAÇÃO

1. Módulo: Configuração da "Matemática do Faturamento" (Números de Ouro)

- Inputs do Usuário: Meta de faturamento mensal, Ticket Médio, Dias de prospecção/semana e Horas/dia dedicadas.

- Funil de Conversão Estimado (%):

  - Ligações → Contato com Decisor

  - Decisores → Reuniões Agendadas

  - Reuniões Agendadas → Reuniões Realizadas (Taxa de Show-up)

  - Reuniões Realizadas → Fechamentos

- Engine de Cálculo Interno: Calcular automaticamente o volume mensal e diário necessário para: Ligações, Decisores Contatados, Reuniões Agendadas, Reuniões Realizadas e Vendas.

2. Módulo: Cockpit do Prospectador / Modo Foco (Substituição da lista e checkboxes)

- Interface de execução diária limpa e sem distrações.

- Temporizador & Pacing: Cálculo dinâmico do tempo máximo permitido por ligação (com base no horário disponível e meta do dia).

- Barra de Progresso Gamificada: Exibe o percentual do dia concluído com base nos registros realizados.

- Disparador de Ações Rápidas por Lead:

  - Botão de Ação rápida para WhatsApp Web.

  - Seleção de resultado da ligação via Hotkeys (Atalhos do teclado) ou menu suspenso: [Reunião Agendada | Dono Não Estava | Retornar | Sem Interesse | Enviar WhatsApp].

  - Campo em destaque: "Nome da Ponte" (Secretária/Atendente) para registrar informações essenciais para contornar o filtro em contatos futuros.

  - Agendamento de Retorno: Data + Horário com gatilho de notificação.

3. Módulo: Importador & Gestão de Leads (Raw Data / CRM)

- Importador de arquivos CSV/Excel com mapeamento inteligente de colunas (Capital Social, Nome do Sócio, Nome Fantasia, Telefone 1 e 2, Bairro, Data de Abertura).

- Lista/Grid com busca rápida e filtros por status, bairro ou data de retorno.

4. Módulo: Diário de Bordo & Inteligência de Conversão (Feedback Loop)

- Registro automático das métricas diárias à medida que o SDR projeta o "Modo Foco".

- Módulo de Ajuste Fino (Sugestão de Métricas): Compara as taxas estimadas dos "Números de Ouro" com as conversões reais acumuladas da semana/mês, sugerindo o recalculo automático da meta diária com base na realidade do funil.

### O QUE VOCÊ DEVE FORNECER:

1. Arquitetura Funcional & Requisitos do Sistema: Descrição detalhada do fluxo do usuário (User Journey).

2. Modelo de Banco de Dados (Schema SQL / Prisma ORM): Tabelas para `Users`, `Goals_Math`, `Leads`, `Call_Logs` e `Daily_Metrics`.

3. Especificação de UI/UX (Layout/Wireframe textual): Detalhamento da tela principal do "Modo Foco / Cockpit" focado em velocidade e ergonomia visual (Modo Escuro / Alto Contraste).

4. Sugestão de Stack Tecnológica: Recomendação de frameworks modernos para rápida execução (ex: Next.js/React, Tailwind CSS, PostgreSQL, Supabase/Prisma).

5. Estrutura de Lógica/Algoritmo: As fórmulas matemáticas e condicionais necessárias em JavaScript/TypeScript para conectar a meta de faturamento com a fila diária de execução.
Atue como um Product Manager (PM) Senior de SaaS B2B, Engenheiro de Software Full-Stack e Especialista em Estratégia de Vendas Outbound/CRM.

Preciso da especificação técnica, arquitetura de software, estrutura de banco de dados e proposta de UI/UX para um SaaS de prospecção focado em alta produtividade, baseado na metodologia de "Matemática do Faturamento" (Marcus Vinícius). 

O sistema deve ser uma ferramenta ultra-ágil para SDRs/BDRs, combinando um CRM de execução rápida com um motor de enriquecimento de leads via API.

### MÓDULOS E FUNCIONALIDADES DA APLICAÇÃO

1. Módulo: Configuração da "Matemática do Faturamento" (Números de Ouro)

- Inputs do Usuário: Meta mensal, Ticket Médio, Dias de prospecção/semana e Horas/dia.

- Funil de Conversão Estimado (%): Ligações → Decisores → Reuniões Agendadas → Reuniões Realizadas → Fechamentos.

- Engine: Cálculo automático do volume diário e mensal necessário de ligações e contatos para bater a meta.

2. Módulo: Cockpit do Prospectador / Modo Foco (Execução Ágil)

- Interface limpa focada em um lead por vez (Fila de trabalho).

- Temporizador & Pacing: Cálculo dinâmico do tempo máximo por ligação.

- Barra de Progresso Gamificada: Atualiza em tempo real conforme as ligações são feitas.

- Ações e Flexibilidade (CRUD no Modo Foco):

  - Botões de Status: [Reunião Agendada | Dono Não Estava | Retornar | Sem Interesse | WhatsApp].

  - Atalhos: Envio rápido para WhatsApp Web.

  - Edição Rápida: Capacidade de editar qualquer dado do lead atual (ex: corrigir nome, atualizar telefone, mudar status do lead) sem sair da tela de foco.

  - Exclusão/Descarte: Botão para apagar/arquivar um lead permanentemente da base caso seja inválido ou fora do perfil, limpando a fila.

  - "Nome da Ponte" & Agendamento: Campos rápidos para anotar o nome da secretária e agendar data/hora de retorno com notificação.

3. Módulo: Motor de Geração e Enriquecimento de Leads (Integração de APIs)

- Botão Mágico "Adquirir Mais Leads": Um botão na interface que, ao ser clicado, abre um modal simples solicitando: "Qual cidade você deseja prospectar?".

- Fluxo de Automação (Backend):

  1. O usuário digita a cidade (Ex: "São Paulo, SP"). O nicho padrão no backend será "Autoescola".

  2. A aplicação faz uma requisição para a API da Apify (Google Maps Scraper) buscando "Autoescola em [Cidade]" para trazer Razão Social, CNPJ (se disponível no site), endereço e avaliações.

  3. A aplicação pega a Razão Social/CNPJ e faz um cross-reference na API do CNPJ.biz.

  4. Extração Profunda: A API do CNPJ.biz retorna o QSA (Nome dos Proprietários/Sócios), Capital Social, Data de Abertura, Telefones 1 e 2 e E-mail.

  5. Criação Automática: O sistema consolida esses dados e cria os leads automaticamente no banco de dados, já inserindo-os na fila do "Modo Foco".

4. Módulo: Gestão de Leads (CRM Base) e Diário de Bordo

- Tabela de gerenciamento completo para visualizar todos os leads gerados e importados.

- Diário de Bordo Automático: Registra métricas diárias e sugere reajustes na "Matemática do Faturamento" com base na conversão real do usuário.

### O QUE VOCÊ DEVE FORNECER:

1. Arquitetura Funcional & Fluxo de Integração (User Journey): Como a interface se comunica com Apify e CNPJ.biz de forma assíncrona para não travar a tela do usuário.

2. Modelo de Banco de Dados (Schema SQL / Prisma ORM): Tabelas detalhadas para `Users`, `Goals`, `Leads` (incluindo campos para QSA, Capital Social, CNPJ), `Call_Logs` e `Daily_Metrics`.

3. Especificação de UI/UX (Layout textual): Desenho mental do "Modo Foco" contemplando os botões de edição rápida, exclusão de lead e o botão "Adquirir Mais Leads".

4. Sugestão de Stack Tecnológica: Next.js/React, Tailwind, PostgreSQL, Supabase e lógicas de Webhooks/Serverless functions para lidar com o timeout das APIs de scraping.

5. Estrutura de Lógica de Requisição: Exemplo de como estruturar a função (em TypeScript) que encadeia a chamada da Apify com a do CNPJ.biz e salva no banco.

Quero uma UI/UX clean fundo branco cores azuis cantos arredondados

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://prospect-flow-02.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bd8591a5-dc52-49d9-9b31-56af768f030f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
