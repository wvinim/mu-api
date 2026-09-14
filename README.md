# mu-api

API do site do servidor privado de MU Online (Season 2.5). Backend puro —
sem frontend, sem app cliente. Ver `CLAUDE.md` para o brief completo do
projeto e o escopo funcional.

## Stack

- Node.js + Express, JavaScript puro (sem TypeScript)
- SQL Server via `mssql` (banco em produção, compartilhado com o gameserver)
- JWT (access + refresh token), bcrypt para senha do site
- Helmet, CORS, `express-rate-limit`
- Logging estruturado com `pino` (+ `pino-http`, `pino-pretty` em dev)
- Testes com Jest + Supertest

## Setup local

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Copie o arquivo de variáveis de ambiente e preencha os valores:

   ```bash
   cp .env.example .env
   ```

   Em desenvolvimento, `DB_USER`/`DB_PASSWORD` só são obrigatórios se o seu
   SQL Server local exigir autenticação. `JWT_*`, `SMTP_*` e `EFI_*` ficam
   vazios até serem implementados (auth, e-mail, loja) — a API sobe sem eles
   em dev, mas as rotas que dependem desses valores vão falhar até serem
   preenchidos.

3. Suba a API:

   ```bash
   npm run dev
   ```

   O servidor tenta conectar no SQL Server na inicialização; se a conexão
   falhar, o processo sai com erro (ver logs).

4. Verifique se subiu:

   ```bash
   curl http://localhost:3000/health        # liveness, sem tocar no banco
   curl http://localhost:3000/health/db     # readiness, testa a conexão com o SQL Server
   ```

## Scripts

| Comando           | O que faz                                  |
| ------------------ | ------------------------------------------- |
| `npm run dev`       | Sobe a API com reload automático (`--watch`) |
| `npm start`         | Sobe a API em modo normal                   |
| `npm test`          | Roda a suíte Jest                           |
| `npm run test:watch`| Roda o Jest em modo watch                   |

## Estrutura

```
src/
  app.js            # monta o Express app (middlewares, rotas, error handler)
  server.js         # ponto de entrada: conecta no banco e sobe o servidor HTTP
  config/env.js      # leitura e validação de variáveis de ambiente
  db/pool.js         # pool de conexão único com o SQL Server (mssql)
  middlewares/        # error handler central, 404 padronizado
  routes/             # rotas da API, montadas em /api/v1
  utils/              # logger (pino), AppError (erro padronizado)
tests/                # testes Jest + Supertest
docs/
  INVENTORY_BYTE_FORMAT.md   # formato binário da coluna Inventory (Loja)
  SECTION_*_*.md              # resumo de decisões/pendências por seção
migrations/
  *.sql                        # migrations revisáveis — NUNCA aplicadas automaticamente
```

## Formato de erro padronizado

Todas as respostas de erro seguem o formato:

```json
{ "error": { "code": "NOT_FOUND", "message": "Rota não encontrada: GET /xyz" } }
```

## Banco de dados — cuidado, é produção ao vivo

O SQL Server usado aqui é o mesmo do gameserver em C++, já em produção.
Esta API **nunca** roda `ALTER TABLE`/`DROP`/migrations destrutivas
automaticamente. Qualquer mudança de schema é gerada como um `.sql`
revisável, para aprovação manual antes de aplicar. Ver `CLAUDE.md` para os
detalhes da estratégia híbrida de senha (client do jogo vs. login do site).

## Status atual

- [x] Seção 1 — Setup do projeto
- [x] Seção 2 — Autenticação (JWT) — validada em produção, ver
      `docs/SECTION_2_AUTH.md`.
- [x] Seção 3 — Perfil da conta — ver `docs/SECTION_3_ACCOUNT.md`.
- [x] Seção 4 — Personagens — ver `docs/SECTION_4_CHARACTERS.md`.
      Ranking por guild removido do escopo por decisão sua.
- [x] Seção 5 — Loja/Créditos (Efí) — ver `docs/SECTION_5_SHOP.md`.
      **Não testada** (sem credenciais de sandbox ainda). Requer aplicar
      `migrations/0002_shop_tables.sql`.
- [x] Seção 6 — Suporte/Tickets — ver `docs/SECTION_6_SUPPORT.md`.
      Requer aplicar `migrations/0003_support_tickets.sql`.
- [x] Seção 7 — Administração — ver `docs/SECTION_7_ADMIN.md`. CRUD de
      pacotes de crédito incluído além do brief literal (ver doc).
- [x] Seção 8 — Status do servidor — ver `docs/SECTION_8_SERVER.md`.
      **Não testada** contra o banco real ainda (confirmar que
      `MEMB_STAT.ConnectStat` reflete quem está online antes de expor a
      rota).

Escopo funcional do `CLAUDE.md` concluído (Seção 6/Notícias pulada por
decisão do usuário). Pendências restantes são as já listadas nos docs de
cada seção (credenciais Efí/SMTP, migrations a aplicar, decisão de
deploy/IIS).
