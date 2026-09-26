# CLAUDE.md — API do site (MU Online Season 2.5)

Este arquivo é o brief do projeto. Leia inteiro antes de escrever qualquer
código. Sempre que uma seção disser "pergunte antes", pare e pergunte ao
usuário — não presuma.

---

## Contexto

Servidor privado de MU Online (base decompilada, Season 2.5). O banco de
dados é **SQL Server**, já está **em produção** e é usado **ao vivo pelo
gameserver em C++**. Esta API vai servir o futuro site do servidor.

**Escopo desta sessão: SOMENTE a API (backend).** Não crie frontend, não
crie app cliente, não crie nada de UI. Só a API.

## Stack definida

- **Node.js + Express**
- **JavaScript puro** (sem TypeScript)
- **JWT** para autenticação (access token + refresh token)
- **SQL Server** via pacote `mssql` — **consultas sempre parametrizadas**,
  nunca concatenar string de usuário em SQL
- **Rate limiting**: `express-rate-limit` (aceitável em memória para
  instância única; se eu confirmar múltiplas instâncias/load balancer,
  perguntar sobre Redis antes de assumir)
- **E-mail**: Nodemailer com SMTP próprio (credenciais via `.env`)
- **Pagamento**: Efí (Gerencianet) — usar o SDK oficial Node se existir, ou
  a API REST deles diretamente. Webhook precisa validar autenticidade da
  notificação antes de creditar qualquer valor.
- **Hash de senha do site**: bcrypt

## Deploy

Decidido e em produção (atualizado 2026-09-26 — substitui o plano
original de rodar no Windows Server do gameserver):

- A API roda num servidor **Ubuntu** separado, atrás de **nginx**
  (reverse proxy + TLS), em `https://api.mupro.vip`. O site fica em
  `https://mupro.vip`. O SQL Server continua no Windows do gameserver.
- Processo gerenciado por **pm2**, com `--exp-backoff-restart-delay`
  (evita loop de restart travando a CPU se a API cair ao subir).
- **O usuário executa os comandos no servidor** (via SSH) — dê instruções
  em bash/Linux; não assuma acesso SSH direto.
- Deploy = `git pull` + `pm2 restart` no servidor. Push só quando o usuário
  pedir.
- E-mail: SMTP da **Umbler**, DNS do domínio na **GoDaddy**; DKIM assinado
  pela própria API (ver `docs/EMAIL_DKIM.md`).

---

## ⚠️ Restrição crítica — banco de dados é produção ao vivo

- **Nunca execute `ALTER TABLE`, `DROP`, ou qualquer migration destrutiva
  direto contra a produção sem confirmação explícita minha.** Gere o SQL
  da migration como um arquivo revisável, e pare para eu aprovar.
- Se possível, peça para eu confirmar se existe um banco de staging/cópia
  antes de qualquer teste que escreva dados.
- A tabela de contas usada pelo client do jogo (provavelmente `MEMB_INFO`
  ou nome parecido) **não pode ter o fluxo de login do jogo quebrado**.
  Não modifique colunas existentes usadas por esse login.

## ⚠️ Estratégia de senha: HÍBRIDA (decisão já tomada, não renegociar)

A senha da conta hoje é **texto puro** numa coluna existente, e o **client
do jogo compara direto contra esse texto puro** no login — não há hash no
lado do gameserver.

Decisão tomada: **manter os dois sistemas de senha, sincronizados.**

- A coluna de senha existente (texto puro) continua existindo e **só é
  usada para o login do client do jogo**. Não remover, não hashear essa
  coluna.
- Criar uma coluna **nova**, sugestão de nome `WebPasswordHash`
  (`NVARCHAR` ou `VARCHAR` compatível com o tamanho de hash do bcrypt),
  usada **exclusivamente pela API/site**.
- **No registro**: gravar a senha em texto puro na coluna existente (no
  formato exato que o client do jogo espera — **pergunte antes de assumir
  encoding**, alguns clients antigos de MU fazem alguma ofuscação mesmo
  chamando de "texto puro" internamente) **e também** gravar o hash bcrypt
  da mesma senha em `WebPasswordHash`.
- **Na troca/reset de senha pelo site**: atualizar **as duas colunas** ao
  mesmo tempo, para as senhas nunca ficarem dessincronizadas entre jogo e
  site.
- **Login do site**: valida **somente** contra `WebPasswordHash` via
  bcrypt compare. Nunca comparar texto puro no fluxo do site.
- **Antes de implementar qualquer coisa disso**: peça para eu colar o
  schema real da tabela de contas (nomes de coluna reais, tipos, tamanho).
  Não adivinhe nomes de coluna.

---

## Estrutura de pastas sugerida

```
src/
  routes/
  controllers/
  services/
  middlewares/
  db/              # pool de conexão mssql, queries parametrizadas
  utils/
  config/
.env.example
package.json
README.md
docs/
  INVENTORY_BYTE_FORMAT.md   # já incluído neste pacote, ver abaixo
```

## Referência técnica já validada (não redescobrir)

O formato binário da coluna `Inventory` da tabela `Character` já foi
investigado e **validado empiricamente** em uma sessão anterior. Está
documentado em `docs/INVENTORY_BYTE_FORMAT.md`, incluído neste pacote.
**Leia esse arquivo antes de implementar qualquer rota da Loja** que
insira itens no inventário — ele contém os offsets de byte, a fórmula do
`type`, e os limites de slot seguros (slots de equipamento vs. mochila).
Reaproveite essa lógica ao portar para Node/JavaScript.

---

## Requisitos técnicos transversais (todas as rotas)

- Validação de entrada em toda rota (sugestão: `joi` ou `express-validator`)
- Erro padronizado em JSON: `{ "error": { "code": "...", "message": "..." } }`
- Middleware de autenticação JWT para rotas protegidas
- Middleware de autorização por papel (player / staff / admin)
- Toda escrita nas tabelas `Character` ou de contas deve gerar um registro
  de auditoria (tabela de log própria da API, não mexer em log do
  gameserver)
- Helmet para headers de segurança, CORS restrito (perguntar domínio de
  produção antes de travar CORS final; liberar localhost em dev)
- Logging estruturado de requests (morgan ou pino)

---

## Escopo funcional — construir nesta ordem

Ao terminar cada seção, gere um resumo curto em `.md` do que foi feito,
decisões tomadas, e passos manuais que o usuário precisa fazer fora do
código (ex: criar coluna nova no banco, configurar SMTP). Pare e pergunte
antes de avançar para a próxima seção se algo ficou ambíguo.

### 1. Setup do projeto
- [ ] Scaffold do Express (`src/app.js`, `src/server.js`)
- [ ] Pool de conexão SQL Server via `mssql`, config por `.env`
- [ ] Middleware central de erro
- [ ] Logging de requests
- [ ] CORS (permissivo em dev, com TODO para produção)
- [ ] Helmet
- [ ] `.env.example` completo (incluído neste pacote como ponto de partida)
- [ ] `README.md` com instruções de setup/execução local

### 2. Autenticação (JWT)
- [ ] `POST /api/v1/auth/register` (grava nas duas colunas de senha, ver
      seção crítica acima)
- [ ] `POST /api/v1/auth/confirm-email` (token com TTL 24h)
- [ ] `POST /api/v1/auth/resend-confirmation` — rate limit: 3/hora
- [ ] `POST /api/v1/auth/login` — retorna access (15min) + refresh (7 dias);
      bloqueia se não confirmou e-mail ou está banido; rate limit: 5
      tentativas/15min por IP e por username; loga tentativa em tabela de
      auditoria
- [ ] `POST /api/v1/auth/refresh-token` — defina e documente se o refresh
      token é de uso único (rotativo) ou reutilizável até expirar, e
      justifique a escolha
- [ ] `POST /api/v1/auth/logout` — precisa de tabela de refresh tokens
      revogados/ativos; proponha o schema
- [ ] `POST /api/v1/auth/forgot-password` — rate limit: 3/hora; nunca
      revelar se o e-mail existe na resposta
- [ ] `POST /api/v1/auth/reset-password` — token de uso único, TTL 1h;
      atualiza as duas colunas de senha
- [ ] `POST /api/v1/auth/change-password` (autenticado) — exige senha
      atual; atualiza as duas colunas; invalida refresh tokens ativos

### 3. Perfil da conta
- [ ] `GET /api/v1/account/me`
- [ ] `PATCH /api/v1/account/me`
- [ ] `GET /api/v1/account/characters`
- [ ] `GET /api/v1/account/security-log`

### 4. Personagens
- [ ] `GET /api/v1/characters/:name`
- [ ] `GET /api/v1/characters/:name/inventory` (perguntar se expõe
      publicamente ou só ao dono autenticado)
- [ ] `GET /api/v1/characters/ranking` (paginado, filtros)
- [ ] Cache de ranking (não consultar o banco a cada request — sugerir TTL)

### 5. Loja / Créditos (Efí)
- [ ] `GET /api/v1/shop/items`
- [ ] `GET /api/v1/shop/items/:id`
- [ ] `POST /api/v1/shop/purchase` (autenticado) — rate limit para evitar
      clique duplicado
- [ ] `GET /api/v1/shop/history`
- [ ] `GET /api/v1/shop/credits`
- [ ] `POST /api/v1/shop/payment/webhook` — **validar autenticidade da
      notificação da Efí antes de creditar** (checar documentação deles
      para o método de validação, ex: assinatura/HMAC); **idempotência
      obrigatória** (não creditar duas vezes a mesma transação)
- [ ] Inserção de item no inventário: **usar exatamente a lógica
      documentada em `docs/INVENTORY_BYTE_FORMAT.md`**, incluindo o
      cuidado de nunca escrever nos slots de equipamento (0-11) — só na
      faixa 12-75. Validar sempre em conta de teste antes de expor a rota
      em produção.
- [ ] Log de auditoria de toda transação da loja

### 6. Suporte / Tickets
- [ ] `POST /api/v1/support/tickets`
- [ ] `GET /api/v1/support/tickets`
- [ ] `GET /api/v1/support/tickets/:id`
- [ ] `POST /api/v1/support/tickets/:id/reply`
- [ ] Rate limit na criação de tickets

### 7. Administração
- [ ] `GET /api/v1/admin/accounts`
- [ ] `POST /api/v1/admin/accounts/:id/ban`
- [ ] `POST /api/v1/admin/accounts/:id/unban`
- [ ] `GET /api/v1/admin/logs`
- [ ] `POST /api/v1/admin/shop/items` (CRUD)
- [ ] Middleware de autorização reforçada para todas as rotas `/admin`

### 8. Status do servidor
- [ ] `GET /api/v1/server/status` (online/offline, players conectados —
      perguntar de onde ler isso: tabela do banco, ou outro mecanismo)
- [ ] `GET /api/v1/server/info`
- [ ] Cache curto (dado muda pouco)

---

## O que preciso te dar antes de você começar a codar

Pergunte por isso explicitamente se eu não tiver colado ainda:

1. Schema real da tabela de contas (`MEMB_INFO` ou equivalente): nomes de
   coluna e tipos para username, senha, email, status de ban, data de
   criação.
2. Confirmação do formato exato esperado no campo de senha do client do
   jogo (texto puro literal, ou alguma ofuscação/encoding).
3. Credenciais de sandbox da Efí (Gerencianet) e link da documentação da
   API deles que estou usando.
4. Credenciais SMTP (host, porta, usuário, senha, remetente).
5. ~~Confirmação de IIS no Windows Server~~ — resolvido: Ubuntu + nginx
   (ver seção Deploy).

## Como trabalhar comigo

- Pare e pergunte sempre que a seção disser "pergunte antes" — não
  presuma valores para isso.
- Nunca rode migration destrutiva contra o que parecer ser a string de
  conexão de produção sem eu confirmar explicitamente.
- Ao final de cada seção numerada do escopo funcional, resuma o que foi
  feito em um `.md` curto e liste passos manuais pendentes meus.
- Escreva testes (Jest) para os caminhos críticos: login, refresh token,
  compra na loja, inserção de item no inventário.
