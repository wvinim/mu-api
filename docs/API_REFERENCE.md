# Referência da API — MU Online Season 2.5 (para o front-end)

Gerado a partir do código-fonte atual (`src/routes`, `src/controllers`,
`src/validators`). Serve como contrato para a sessão do front-end —
evita precisar ler o backend inteiro de novo. Se o backend mudar depois
desta data, regenere este doc (peça pra sessão da API atualizar) em vez
de confiar cegamente nele.

## Base

- **Base URL**: `http://localhost:3000/api/v1` (dev) — prefixo `/api/v1`
  em tudo, exceto os health checks (`GET /health`, `GET /health/db`, sem
  prefixo).
- **Auth**: header `Authorization: Bearer <accessToken>` nas rotas
  protegidas.
- **Erro padronizado** (sempre este formato, em qualquer 4xx/5xx):
  ```json
  { "error": { "code": "ALGUM_CODE", "message": "Mensagem legível.", "details": {} } }
  ```
  `details` é opcional e nem sempre existe.
- **CORS**: em dev aceita qualquer origin (`credentials: true`). Em
  produção será restrito — ver CLAUDE.md do backend.
- Rotas paginadas sempre devolvem `{ page, limit, total, items }`.

## Papéis (roles)

`player` | `staff` | `admin`, calculado no backend por lista fixa de
usernames (nunca é uma coluna do banco). Aparece em `GET /account/me`
como `role`, em `GET /admin/accounts` (um `role` por item da listagem) e
em `req.user.role` internamente. Rotas `/admin/*` exigem `admin` (staff
recebe 403).

---

## Auth (`/auth`) — nenhuma exige token, exceto `change-password`

| Método | Rota | Body | Resposta 200/201 | Erros notáveis |
|---|---|---|---|---|
| POST | `/auth/register` | `{ username, password, email }` — username 4-10 alfanumérico/`_`, password 6-10 chars (limite do client do jogo) | 201 `{ message }` | 409 `USERNAME_TAKEN` |
| POST | `/auth/confirm-email` | `{ token }` | `{ message }` | token inválido/expirado |
| POST | `/auth/resend-confirmation` | `{ email }` | `{ message }` — sempre a mesma mensagem, nunca revela se o e-mail existe | rate limit 3/hora |
| POST | `/auth/login` | `{ username, password }` | `{ accessToken, refreshToken, expiresIn }` | 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_BANNED`, 403 `EMAIL_NOT_CONFIRMED`; rate limit 5/15min (IP e username) |
| POST | `/auth/refresh-token` | `{ refreshToken }` | `{ accessToken, refreshToken, expiresIn }` — **refresh token é rotativo (uso único)**: o antigo é invalidado, use sempre o novo devolvido | 401 se inválido/revogado/expirado |
| POST | `/auth/logout` | `{ refreshToken }` | `{ message }` | — |
| POST | `/auth/forgot-password` | `{ email }` | `{ message }` — mesma resposta sempre | rate limit 3/hora |
| POST | `/auth/reset-password` | `{ token, password }` | `{ message }` | token de uso único, TTL 1h |
| POST | `/auth/change-password` 🔒 | `{ currentPassword, newPassword }` | `{ message }` — **invalida todos os refresh tokens ativos**, é preciso logar de novo | 401 `INVALID_CURRENT_PASSWORD` |

`accessToken` expira em 15min (`expiresIn` no formato `"15m"`),
`refreshToken` em 7 dias. Front-end precisa implementar o fluxo de
refresh automático (ex: interceptor que tenta `/auth/refresh-token` no
primeiro 401 e refaz a request original).

---

## Conta (`/account`) — todas exigem 🔒

| Método | Rota | Query/Body | Resposta |
|---|---|---|---|
| GET | `/account/me` | — | `{ username, displayName, email, role, emailConfirmed, cash, vip, vipStartDate, vipEndDate, createdAt }` |
| PATCH | `/account/me` | `{ displayName }` (obrigatório, max 10) | `{ message }` |
| GET | `/account/characters` | — | `{ characters: [...] }` — mesmos campos do perfil de personagem completo (ver abaixo), sem filtro de privacidade (é o dono) |
| GET | `/account/security-log` | `?page&limit` (limit máx 100) | `{ page, limit, total, items }` — histórico de login/troca de senha/etc |
| GET | `/account/autopick` | — | `{ items: [{ itemGroup, itemIndex, itemLevel, name }] }` — seleção salva de autopick VIP. Retorna o que já foi salvo **mesmo que a conta não seja Mega Vip agora** (não limpa em downgrade/expiração) |
| PUT | `/account/autopick` | `{ items: [{ itemGroup, itemIndex, itemLevel }] }` (máx 12, sem duplicados) | `{ message, items }`. **Substitui a seleção inteira**. Só permitido se a conta é Mega Vip (`vip === 3`) **no momento da chamada** — senão **403** `MEGA_VIP_REQUIRED`. Bloqueado com **409** `CHARACTER_ONLINE` se a conta está logada no jogo neste momento (mesma checagem da loja) — nada é gravado nesse caso. Cada item precisa estar na lista fechada de 12 permitidos abaixo — item fora da lista dá **400** |

Lista fechada de itens selecionáveis pro autopick (Mega Vip) — o
front-end deve mostrar os `name` abaixo como opções fixas, marcando as
combinações `itemGroup:itemIndex:itemLevel` já presentes em
`GET /account/autopick`:

| name | itemGroup | itemIndex | itemLevel |
|---|---|---|---|
| Horn of Uniria | 13 | 2 | 0 |
| Imp | 13 | 1 | 0 |
| Jewel of Chaos | 12 | 15 | 0 |
| Jewel of Soul | 14 | 14 | 0 |
| Jewel of Bless | 14 | 13 | 0 |
| Jewel of Life | 14 | 16 | 0 |
| Box of Kundun +1 | 14 | 11 | 8 |
| Box of Kundun +2 | 14 | 11 | 9 |
| Box of Kundun +3 | 14 | 11 | 10 |
| Box of Kundun +4 | 14 | 11 | 11 |
| Box of Kundun +5 | 14 | 11 | 12 |
| Loch's Feather | 13 | 14 | 0 |

O Super Vip (tier 2) tem autopick **fixo** (Jewel of Soul + Jewel of
Bless, gravado automaticamente na compra) — não usa `PUT /account/autopick`.

---

## Personagens (`/characters`) — públicas, sem auth

| Método | Rota | Query/Params | Resposta |
|---|---|---|---|
| GET | `/characters/:name` | — | Perfil público: `{ name, level, classCode, experience, resets, resetsDay, resetsWeek, resetsMonth, strength, dexterity, vitality, energy, pkCount, pkLevel, leadership, createdAt, lastPlayedAt }`. **Nunca inclui** `money`, posição no mapa, `accountId`. 404 se não existir. |
| GET | `/characters/ranking` | `?page&limit(máx 100)&classCode` | `{ page, limit, total, items }` — ordenado por `resets DESC, level DESC`. Cacheado ~60s no servidor. |

`classCode` é o `tinyint` cru da coluna `Class` — **não decodificado**
para nome de classe (ex: "Dark Knight"). Se precisar exibir nome, o
front-end precisa da tabela de mapeamento (não existe no backend ainda).

Não existe `GET /characters/:name/inventory` (decisão: site não mostra
inventário).

---

## Loja / Créditos (`/shop`)

| Método | Rota | Auth | Body/Query | Resposta |
|---|---|---|---|---|
| GET | `/shop/items` | não | — | `{ items: [...] }` — catálogo único misturando pacotes de crédito, itens resgatáveis e **pacotes de itens (bundles)**, diferenciados por `kind` |
| GET | `/shop/items/:id` | não | `id` = `credit:<n>`, `item:<n>` ou `bundle:<n>` | uma entrada do catálogo, 404 se inativo/inexistente |
| POST | `/shop/purchase` | 🔒 | `{ catalogId }` — mesmo body pra todo tipo de compra, nenhuma recebe `characterName` (ver abaixo) | ver abaixo |
| GET | `/shop/credits` | 🔒 | — | `{ cash }` |
| GET | `/shop/history` | 🔒 | `?page&limit` | `{ page, limit, total, items }` — unifica compras de crédito + resgates de item + resgates de pacote + compras de VIP (`type: "vip_purchase"`) |

**`catalogId`** sempre no formato `"credit:<id>"` (pacote Pix→Cash),
`"item:<id>"` (item avulso resgatável, gasta Cash), `"bundle:<id>"`
(pacote — vários itens do catálogo entregues juntos por um preço único)
ou `"vip:<id>"` (plano VIP, gasta Cash). O front-end deve usar esse
`catalogId` exatamente como veio de `/shop/items` — não montar na mão.
**Nenhum tipo de compra recebe `characterName`** — resgate de item/pacote
vai pro baú da conta (warehouse), não pro personagem (mudou em
2026-09-17, ver abaixo).

Uma entrada `kind: "vip_plan"` de `/shop/items` traz `{ tier, priceCredits, durationDays }`
(`tier`: 1 = Vip, 2 = Super Vip, 3 = Mega Vip; `durationDays` sempre 30
hoje, mas trate como dinâmico). Catálogo sempre tem exatamente 3 planos
ativos por padrão (um por tier) — admin só edita preço/ativo, não
cria/remove planos.

Uma entrada `kind: "item_bundle"` de `/shop/items` traz
`items: [{ name, quantity }]` com o conteúdo do pacote, pra mostrar pro
comprador o que ele está levando (ex: `[{ name: "Jewel Pack", quantity: 10 }, { name: "Kundun Box", quantity: 10 }]`).

Resposta de `POST /shop/purchase`:
- Se `catalogId` é `credit:*` → **201** `{ type: "pix_charge", txid, pixCopiaECola, qrCodeImage, amountCents, creditsAmount }`. O front-end mostra o QR code / copia-e-cola Pix; o crédito de `cash` só acontece depois, via webhook confirmado pela Efí (assíncrono — o front-end precisa fazer polling em `/shop/credits` ou `/shop/history` até o saldo mudar, não há WebSocket/push).
- Se `catalogId` é `item:*` → **201** `{ type: "item_redeemed", item, slot }` — `slot` é uma posição no **baú da conta** (warehouse), 0 a 119, não mais na mochila do personagem. Erros: 402 `INSUFFICIENT_CREDITS`, 404 se item não existe/inativo, 409 `CHARACTER_ONLINE` se a conta está logada no jogo neste momento, 409 `WAREHOUSE_FULL` se não há espaço livre de verdade no baú (a checagem entende o tamanho real de cada item já presente — um item 2x2 ocupa 4 células, não 1 — não só conta bytes vazios no array), 409 `WAREHOUSE_UNKNOWN_ITEM` se o baú tiver algum item que não reconhecemos (não sabemos o footprint dele com segurança, então a API recusa em vez de arriscar) — nesses 409 e no 402 o Cash **não é debitado** (checagem acontece antes do débito, front-end não precisa se preocupar com estorno aqui). Se a conta nunca abriu o baú no jogo, a API cria a linha automaticamente (não é erro).
- Se `catalogId` é `bundle:*` → **201** `{ type: "bundle_redeemed", bundle, slots: [...] }` — um slot do baú por unidade de cada item do pacote. Mesmos erros do resgate de item avulso (402/404/409 `CHARACTER_ONLINE`/`WAREHOUSE_FULL`/`WAREHOUSE_UNKNOWN_ITEM`, o `WAREHOUSE_FULL` aqui é quando não há espaço pra **todos** os itens do pacote de uma vez); em nenhum desses casos o Cash é debitado.
- Se `catalogId` é `vip:*` → **sem** `characterName`. **201** `{ type: "vip_purchased", tier, vipStartDate, vipEndDate }`. Erros: 402 `INSUFFICIENT_CREDITS`, 404 se o plano não existe/está inativo. A tier sempre passa a ser a do plano comprado (dá pra trocar de tier "no meio" da validade). Regra de soma de dias (mudou em 2026-09-17, ver abaixo): **upgrade não soma, renovação/downgrade soma**. Comprar Super Vip (tier 2) grava automaticamente o autopick fixo (Jewel of Soul + Jewel of Bless) — ver seção `/account/autopick` acima.

  **Regra de validade (`vipStartDate`/`vipEndDate`) — vale igual pra `/shop/purchase` (`vip:*`) e `POST /admin/accounts/:id/vip`:**
  - Sem VIP ativo no momento da compra (expirado ou nunca teve): conta a partir de agora — `vipStartDate = agora`, `vipEndDate = agora + duração do plano`.
  - **Upgrade** (tier comprada **maior** que a tier ativa agora): **reseta**, não soma — `vipStartDate = agora`, `vipEndDate = agora + duração do novo plano`. Os dias restantes do plano anterior (mais barato) são **descartados**, não creditados.
  - **Renovação** (mesma tier) ou **downgrade** (tier comprada **menor** que a ativa): **soma** a duração do plano à validade atual — `vipStartDate` não muda, `vipEndDate = vipEndDate atual + duração do plano comprado`.
  - Front-end: ao exibir o resultado de uma compra de VIP, não presuma mais "sempre soma X dias" — leia `vipEndDate` da resposta e compare com o valor anterior pra saber se foi upgrade (resetou) ou renovação/downgrade (somou); se for útil pra UX, mostre um aviso antes da confirmação de compra quando a tier escolhida for maior que a atual, avisando que os dias restantes do plano atual serão perdidos.
- Rate limit: 1 compra a cada 3s por conta (evita clique duplicado).

`GET /shop/payment/webhook/:secret` **não é para o front-end** — é
chamado pela Efí diretamente.

---

## Suporte / Tickets (`/support`) — todas exigem 🔒

| Método | Rota | Body/Query | Resposta |
|---|---|---|---|
| POST | `/support/tickets` | `{ subject(máx 200), message(máx 4000) }` | 201 `{ id, subject, status: "open" }`. Rate limit 5/hora |
| GET | `/support/tickets` | `?page&limit&status(open\|closed)` | `{ page, limit, total, items }` — player vê só os próprios (todos os status por padrão); staff/admin veem todos, mas **sem `status`, encerrados ficam escondidos** — usar `?status=closed` pra ver |
| GET | `/support/tickets/:id` | — | ticket + `{ replies: [{ ..., authorRole }] }`. **404 (não 403)** se não for o dono e não for staff/admin |
| POST | `/support/tickets/:id/reply` | `{ message(máx 4000) }` | 201 `{ message }`. Mesma regra de acesso do GET |
| POST | `/support/tickets/:id/close` | — | 200 `{ message }`. Mesma regra de acesso do GET. **409** se já estiver encerrado |

---

## Administração (`/admin`) — todas exigem 🔒 + role `admin` (staff = 403)

| Método | Rota | Body/Query | Resposta |
|---|---|---|---|
| GET | `/admin/accounts` | `?page&limit&search&banned(bool)` | `{ page, limit, total, items }` — item: `{ id, username, displayName, email, emailConfirmed, banned, cash, vip, createdAt, role }`. `id` = `username` (MEMB_INFO não tem PK numérica própria — memb___id é a chave real, e é o mesmo valor esperado em `:id` nas rotas de ban/unban abaixo). `role` é derivado (`player`/`staff`/`admin`) das listas fixas do `.env`, não é coluna |
| POST | `/admin/accounts/:id/ban` | — | `{ message }` — também revoga todos os refresh tokens da conta. `:id` é o username |
| POST | `/admin/accounts/:id/unban` | — | `{ message }` |
| POST | `/admin/accounts/:id/vip` | `{ tier(0-3), days }` — `days` obrigatório se `tier > 0`, proibido se `tier === 0` | `{ message, vip, vipStartDate, vipEndDate }`. `tier > 0`: concede/estende (mesma regra de soma de dias da compra normal). `tier === 0`: revoga imediatamente (`VipEndDate = agora`) |
| GET | `/admin/logs` | `?page&limit&accountId&eventType` | `{ page, limit, total, items }` — `WebAuditLog` completo, incluindo `id` (PK própria da tabela) |
| GET/POST | `/admin/shop/items` | POST: `{ name, description?, priceCredits, itemGroup, itemIndex, itemLevel?, quantity?, active? }` | GET `{ items }`; POST 201 `{ id }` |
| PATCH/DELETE | `/admin/shop/items/:id` | PATCH: qualquer subconjunto dos campos acima | `{ message }`. DELETE é soft-delete (`active=false`) |
| GET/POST | `/admin/shop/bundles` | POST: `{ name, description?, priceCredits, active?, items: [{ shopItemId, quantity? }] }` (`items` não pode ser vazio) | GET `{ items }` — cada item traz `items: [{ shopItemId, itemName, quantity }]`; POST 201 `{ id }` |
| PATCH/DELETE | `/admin/shop/bundles/:id` | PATCH: qualquer subconjunto dos campos acima — **se `items` vier, substitui a lista inteira**, não faz merge | `{ message }`. DELETE é soft-delete (`active=false`) |
| GET/POST | `/admin/shop/credit-packages` | POST: `{ name, priceCents, creditsAmount, active? }` | igual ao padrão acima |
| PATCH/DELETE | `/admin/shop/credit-packages/:id` | PATCH: subconjunto dos campos | igual ao padrão acima |
| GET | `/admin/shop/vip-plans` | — | `{ items: [{ id, tier, name, priceCredits, durationDays, active, createdAt }] }` — sempre 3 linhas (uma por tier) |
| PATCH | `/admin/shop/vip-plans/:id` | `{ priceCredits?, active? }` — **só esses 2 campos**, `tier`/`name`/`durationDays` não são editáveis | `{ message }` |

`shopItemId` em `/admin/shop/bundles` referencia um item já cadastrado em
`/admin/shop/items` — pra vender só dentro do pacote (não avulso), marque
esse item com `active: false`; ele some do catálogo avulso mas continua
funcionando como componente de um pacote.

---

## Status do servidor (`/server`) — públicas, sem auth

| Método | Rota | Resposta |
|---|---|---|
| GET | `/server/status` | `{ status: "online", playersOnline: N }`. Cacheado ~15s. Se o SQL Server cair, retorna erro (não um `"offline"` silencioso) |
| GET | `/server/info` | `{ name, season, expRate, dropRate, maxResets, websiteUrl }` — metadados estáticos, podem vir vazios (`""`) se não configurados no `.env` do backend |

---

## Não implementado (fora do escopo desta API)

- Notícias/changelog (`/news`, `/changelog`) — seção pulada por decisão
  do usuário.
- Downloads, Guild, Eventos — removidos do escopo do backend.
- Ranking de guild.
- Inventário de personagem via API pública.

## Fluxo de auth sugerido no front-end

1. Login → guardar `accessToken` (memória/estado, não localStorage se
   puder evitar) e `refreshToken` (httpOnly cookie seria ideal, mas o
   backend hoje devolve os dois no corpo — decisão de storage é do
   front-end).
2. Em cada 401 de uma rota protegida, tentar `/auth/refresh-token` uma
   vez com o refresh guardado; se funcionar, refazer a request original
   com o novo `accessToken`; se falhar, deslogar.
3. Lembrar que refresh token é **rotativo**: sempre substituir o
   guardado pelo novo devolvido, nunca reusar o antigo.
