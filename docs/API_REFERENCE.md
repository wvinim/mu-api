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

---

## Personagens (`/characters`) — públicas, sem auth

| Método | Rota | Query/Params | Resposta |
|---|---|---|---|
| GET | `/characters/:name` | — | Perfil público: `{ name, level, classCode, experience, resets, resetsDay, resetsWeek, resetsMonth, strength, dexterity, vitality, energy, pkCount, pkLevel, leadership, createdAt, lastPlayedAt }`. **Nunca inclui** `money`, posição no mapa, `accountId`. 404 se não existir. |
| GET | `/characters/ranking` | `?page&limit(máx 100)&classCode&search` | `{ page, limit, total, items }` — ordenado por `resets DESC, level DESC`. Cacheado ~60s no servidor. |

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
| POST | `/shop/purchase` | 🔒 | `{ catalogId }` (compra créditos) ou `{ catalogId, characterName }` (resgata item ou pacote) | ver abaixo |
| GET | `/shop/credits` | 🔒 | — | `{ cash }` |
| GET | `/shop/history` | 🔒 | `?page&limit` | `{ page, limit, total, items }` — unifica compras de crédito + resgates de item + resgates de pacote |

**`catalogId`** sempre no formato `"credit:<id>"` (pacote Pix→Cash),
`"item:<id>"` (item avulso resgatável, gasta Cash) ou `"bundle:<id>"`
(pacote — vários itens do catálogo entregues juntos por um preço único).
O front-end deve usar esse `catalogId` exatamente como veio de
`/shop/items` — não montar na mão.

Uma entrada `kind: "item_bundle"` de `/shop/items` traz
`items: [{ name, quantity }]` com o conteúdo do pacote, pra mostrar pro
comprador o que ele está levando (ex: `[{ name: "Jewel Pack", quantity: 10 }, { name: "Kundun Box", quantity: 10 }]`).

Resposta de `POST /shop/purchase`:
- Se `catalogId` é `credit:*` → **201** `{ type: "pix_charge", txid, pixCopiaECola, qrCodeImage, amountCents, creditsAmount }`. O front-end mostra o QR code / copia-e-cola Pix; o crédito de `cash` só acontece depois, via webhook confirmado pela Efí (assíncrono — o front-end precisa fazer polling em `/shop/credits` ou `/shop/history` até o saldo mudar, não há WebSocket/push).
- Se `catalogId` é `item:*` → precisa também de `characterName` no body. **201** `{ type: "item_redeemed", item, characterName, slot }`. Erros: 402 `INSUFFICIENT_CREDITS`, 404 se personagem não pertence à conta.
- Se `catalogId` é `bundle:*` → precisa também de `characterName`. **201** `{ type: "bundle_redeemed", bundle, characterName, slots: [...] }` — um slot da mochila por unidade de cada item do pacote. **Tudo ou nada**: se não houver espaço pra todos os itens, nada é gravado e o Cash é estornado (mesmos erros 402/404/409 `INVENTORY_FULL` do resgate de item avulso).
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
| GET | `/admin/logs` | `?page&limit&accountId&eventType` | `{ page, limit, total, items }` — `WebAuditLog` completo, incluindo `id` (PK própria da tabela) |
| GET/POST | `/admin/shop/items` | POST: `{ name, description?, priceCredits, itemGroup, itemIndex, itemLevel?, quantity?, active? }` | GET `{ items }`; POST 201 `{ id }` |
| PATCH/DELETE | `/admin/shop/items/:id` | PATCH: qualquer subconjunto dos campos acima | `{ message }`. DELETE é soft-delete (`active=false`) |
| GET/POST | `/admin/shop/bundles` | POST: `{ name, description?, priceCredits, active?, items: [{ shopItemId, quantity? }] }` (`items` não pode ser vazio) | GET `{ items }` — cada item traz `items: [{ shopItemId, itemName, quantity }]`; POST 201 `{ id }` |
| PATCH/DELETE | `/admin/shop/bundles/:id` | PATCH: qualquer subconjunto dos campos acima — **se `items` vier, substitui a lista inteira**, não faz merge | `{ message }`. DELETE é soft-delete (`active=false`) |
| GET/POST | `/admin/shop/credit-packages` | POST: `{ name, priceCents, creditsAmount, active? }` | igual ao padrão acima |
| PATCH/DELETE | `/admin/shop/credit-packages/:id` | PATCH: subconjunto dos campos | igual ao padrão acima |

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
