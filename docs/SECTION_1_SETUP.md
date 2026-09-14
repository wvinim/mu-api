# Seção 1 — Setup do projeto (concluída)

## O que foi feito

- Scaffold do Express separado em `src/app.js` (monta middlewares/rotas,
  exportado para testes) e `src/server.js` (conecta no banco e sobe o
  HTTP server — ponto de entrada real).
- Pool de conexão único com o SQL Server via `mssql` em `src/db/pool.js`
  (`connectDB()`, `getPool()`, `closeDB()`), configurado 100% por `.env`.
  Nenhuma query de schema/DDL incluída — só a infraestrutura de conexão.
- Middleware central de erro (`src/middlewares/errorHandler.js`) seguindo
  o formato padronizado do brief: `{ "error": { "code", "message" } }`.
  Erros de negócio devem ser lançados como `AppError` (`src/utils/AppError.js`).
- 404 padronizado (`src/middlewares/notFound.js`), no mesmo formato de erro.
- Logging estruturado com `pino` (`src/utils/logger.js`) + `pino-http` para
  log de cada request. Em dev usa `pino-pretty` (legível no terminal); em
  produção sai JSON puro (fácil de agregar).
- CORS: em dev libera qualquer origin (`origin: true`) para não travar o
  front-end local. Em produção, usa `CORS_ALLOWED_ORIGINS` do `.env` — que
  **ainda não foi confirmado** (ver pendência abaixo).
- Helmet habilitado com os defaults (headers de segurança básicos).
- `.env.example` → renomeado de `env.example` para `.env.example` (o
  `.gitignore` já esperava esse nome exato).
- `README.md` com instruções de setup local, scripts disponíveis e
  estrutura de pastas.
- Rotas de health check: `GET /health` (liveness, não toca no banco — útil
  para probe de infra tipo IIS ARR) e `GET /health/db` (readiness, testa
  `SELECT 1` no SQL Server).
- Testes Jest + Supertest básicos (`tests/health.test.js`) cobrindo o
  health check e o formato do erro 404.

## Decisões tomadas

- **Logging**: escolhido `pino` em vez de `morgan` — o brief permitia
  qualquer um, e o requisito transversal pede "logging estruturado", que é
  o forte do pino (JSON nativo, bom para produção).
- **`GET /health`**: adicionado fora do escopo funcional numerado porque é
  necessário para verificar se o setup básico funciona, e é convenção comum
  para probes de load balancer / reverse proxy. Montado tanto em `/health`
  quanto em `/api/v1/health` (mesma rota, sem prefixo de versão para probes
  de infra).
- **Pool de conexão**: `max: 10` conexões — valor conservador de ponto de
  partida, já que o banco é compartilhado ao vivo com o gameserver. Pode
  ajustar depois se houver gargalo, mas prefiro começar baixo.
- **Nenhuma query real contra o banco** foi escrita nesta seção — só a
  infraestrutura do pool. Não haverá risco de leitura/escrita na produção
  até a Seção 2+.

## Pendências / passos manuais seus

1. **Rodar `npm install`** — não consegui verificar Node.js/npm instalados
   nesta máquina (comando `node`/`npm` não encontrado no PATH). Confirme
   que o Node está instalado (`engines` no `package.json` pede >= 18) antes
   de instalar as dependências.
2. **Copiar `.env.example` para `.env`** e preencher pelo menos as
   credenciais do SQL Server local/de teste para a API subir.
3. **CORS de produção**: ainda preciso que você confirme o domínio final
   do site antes de travar `CORS_ALLOWED_ORIGINS` — hoje é só um TODO no
   código (`src/app.js`).
4. **IIS**: a decisão de reverse proxy (IIS com ARR vs. Caddy) fica para
   quando chegarmos nas instruções de deploy — só vou perguntar sobre isso
   nesse momento, não antes.

## Próxima seção

Seção 2 (Autenticação) está **bloqueada**: preciso que você cole o schema
real da tabela de contas (`MEMB_INFO` ou equivalente — colunas e tipos de
username, senha, e-mail, status de ban, data de criação) e confirme o
formato exato esperado no campo de senha pelo client do jogo, antes de
escrever qualquer coisa relacionada a registro/login/senha. Ver `CLAUDE.md`,
seção "⚠️ Estratégia de senha" e "O que preciso te dar antes de você
começar a codar".
