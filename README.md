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
| `npm run dump-inventory -- <Nome>` | Diagnóstico só-leitura do `Inventory` de um personagem (bytes + grade 2D real) |
| `npm run generate-item-dimensions` | Regenera `src/data/itemDimensions.json` a partir de `docs/inv/Item.txt` |
| `npm run generate-dkim-key -- [caminho] [seletor]` | Gera chave DKIM e imprime o TXT para o DNS (ver `docs/EMAIL_DKIM.md`) |
| `npm run check-dkim` | Confere se o TXT DKIM publicado bate com a chave do `.env` |

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
  data/itemDimensions.json  # grupo:índice -> largura/altura real (gerado, ver scripts/)
tests/                # testes Jest + Supertest
scripts/
  dumpInventorySlots.js       # diagnóstico só-leitura do Inventory de um personagem
  generateItemDimensions.js   # gera src/data/itemDimensions.json a partir de docs/inv/Item.txt
docs/
  INVENTORY_BYTE_FORMAT.md   # formato binário da coluna Inventory (Loja)
  inv/Item.txt, item.bmd      # tabela de itens do client (fonte de largura/altura)
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
      **Pagamento Pix não testado** (sem credenciais de sandbox ainda).
      Requer aplicar `migrations/0002_shop_tables.sql`.
      **Resgate de item/bundle validado empiricamente em conta de teste**
      (inserção no `Inventory`, bloqueio por mochila cheia, bloqueio por
      personagem online) — ver os dois bugs de produção abaixo, já
      corrigidos e com teste de regressão.
      Bug 1: FK de `WebItemRedemptions`/`WebBundleRedemptions` para
      `Character(Name)` travava o DELETE do personagem (e derrubava o
      gameserver) depois de um resgate — corrigido com
      `migrations/0005_fix_redemption_character_fk.sql`, **aplicada e
      validada em produção** (schema confirmado + delete testado pelo
      client do jogo).
      Bug 2: itens maiores que 1x1 (ex: armadura 2x2) já presentes na
      mochila "escondiam" células que o scanner via como livres — itens
      da loja eram gravados no banco mas nunca apareciam no jogo. Corrigido
      com uma grade 2D real baseada em `docs/inv/Item.txt` (ver
      `docs/SECTION_5_SHOP.md`).
      Resgate agora também bloqueia se o personagem estiver online
      (`MEMB_STAT.ConnectStat`) ou sem espaço na mochila, checado **antes**
      de debitar o Cash.
- [x] Seção 6 — Suporte/Tickets — ver `docs/SECTION_6_SUPPORT.md`.
      Requer aplicar `migrations/0003_support_tickets.sql`.
- [x] Seção 7 — Administração — ver `docs/SECTION_7_ADMIN.md`. CRUD de
      pacotes de crédito incluído além do brief literal (ver doc).
- [x] Seção 8 — Status do servidor — ver `docs/SECTION_8_SERVER.md`.
      **Não testada** contra o banco real ainda (confirmar que
      `MEMB_STAT.ConnectStat` reflete quem está online antes de expor a
      rota).
- [x] Seção 9 — Sistema de VIP (fora do escopo original do CLAUDE.md,
      pedida via `docs/VIP_SYSTEM.md`) — ver `docs/SECTION_9_VIP.md`.
      Compra de plano VIP (Cash → `MEMB_INFO.Vip`/`VipStartDate`/`VipEndDate`),
      autopick do Super Vip (fixo) e Mega Vip (configurável, lista fechada
      de 12 itens, gravado em `MEMB_AUTOPICK_ITEMS`), admin de
      concessão/revogação manual. **Não testada** contra o banco real
      ainda. Requer aplicar `migrations/0006_vip_plans.sql`.

Escopo funcional do `CLAUDE.md` concluído (Seção 6/Notícias pulada por
decisão do usuário), mais a Seção 9 (VIP) adicionada depois por pedido
separado. Pendências restantes são as já listadas nos docs de cada seção
(credenciais Efí/SMTP, migrations a aplicar, decisão de deploy/IIS).
