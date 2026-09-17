# Seção 9 — Sistema de VIP (fora do escopo numerado original do CLAUDE.md)

Feature pedida via `docs/VIP_SYSTEM.md` (arquivo que o usuário adicionou
ao repo com a especificação). Não fazia parte das 8 seções originais do
`CLAUDE.md`, mas segue os mesmos requisitos transversais (validação,
erro padronizado, JWT, auditoria, CORS/Helmet já cobertos pela Seção 1).

## Conceito

4 tiers de conta, já existentes como coluna `MEMB_INFO.Vip` (0 = Free,
1 = Vip, 2 = Super Vip, 3 = Mega Vip) — só líamos isso antes (`GET
/account/me`, `GET /admin/accounts`); esta seção passa a **escrever**
nessas colunas pela primeira vez.

- **Vip / Super Vip / Mega Vip**: validade fixa de 30 dias, comprada com
  Cash (mesmo saldo da loja de itens).
- **Super Vip**: autopick fixo (coleta automática de `Jewel of Soul` +
  `Jewel of Bless` ao cair no chão) — controlado pelo gameserver, mas a
  API grava os 2 itens fixos em `MEMB_AUTOPICK_ITEMS` na compra.
- **Mega Vip**: autopick configurável — o usuário escolhe quais itens
  quer coletar automaticamente, de uma lista fechada de 12 (ver tabela
  abaixo). A API valida a seleção contra essa lista e grava em
  `MEMB_AUTOPICK_ITEMS`.

## Decisões tomadas com o usuário (não renegociar sem confirmar de novo)

1. **Compra com Cash** (não Pix direto) — mesmo padrão de item/bundle:
   `catalogId: "vip:<id>"` em `POST /shop/purchase`, sem `characterName`
   (VIP é da conta).
2. **Renovação soma dias**: comprar de novo (mesma tier ou diferente)
   soma a duração do plano (30 dias) em cima do que sobrar da validade
   atual — nunca soma em cima de uma data já vencida no passado (se
   estava expirado ou nunca teve VIP, conta a partir de agora). A tier
   sempre passa a ser a comprada mais recentemente.
3. **Super Vip grava autopick fixo**: a compra do plano tier 2 insere
   (idempotente, sem duplicar/apagar seleção de Mega Vip pré-existente)
   as 2 linhas fixas em `MEMB_AUTOPICK_ITEMS`.
4. **Sem limite de seleção pro Mega Vip** — pode marcar os 12 itens da
   lista de uma vez.
5. **`MEMB_AUTOPICK_ITEMS` já existe em produção** (criada pelo usuário
   fora desta API, schema colado em `docs/VIP_SYSTEM.md`) — **não** há
   migration pra ela. Colunas em PascalCase com `AccountID` (I
   maiúsculo), diferente do padrão `AccountId` do resto do projeto.
6. **Downgrade/expiração NÃO limpa a seleção salva** — se uma conta deixa
   de ser Mega Vip (expira ou compra uma tier menor), as linhas em
   `MEMB_AUTOPICK_ITEMS` continuam lá; quem decide se usa é o gameserver,
   olhando a tier atual no momento da coleta. Se virar Mega Vip nesse
   personagem de novo depois, a seleção antiga reaparece.
7. **Catálogo de planos é fixo**: sempre exatamente 3 linhas (uma por
   tier), semeadas pela migration. Admin só edita `priceCredits`/`active`
   — não é um CRUD livre como `WebShopItems`/`WebShopBundles`.
8. **Endpoint de admin incluído**: `POST /admin/accounts/:id/vip` pra
   conceder/estender ou revogar VIP manualmente (compensação de suporte),
   mesmo espírito de `POST /admin/accounts/:id/ban`.

## ⚠️ Investigação de itens do autopick — não redescobrir

A lista de 12 itens do `docs/VIP_SYSTEM.md` foi cruzada contra
`docs/inv/Item.txt` (mesma fonte usada pra `src/data/itemDimensions.json`,
ver `docs/SECTION_5_SHOP.md`). Duas armadilhas reais encontradas e
resolvidas com o usuário, documentadas aqui pra não serem redescobertas:

1. **"Jewel of Soul"/"Jewel of Bless" têm dois candidatos** em
   `Item.txt`: a versão "pura" (grupo 14) e uma versão
   `"bundle of..."`/`"budle of..."` (grupo 12, nomes com erro de
   digitação no próprio arquivo). **Confirmado com o usuário: é a versão
   pura (grupo 14)** — a que cai no chão dos monstros.
2. **"Box of Kundun +1" até "+5" não existem por esse nome** em
   `Item.txt`. São, na verdade, o item **"Box of Luck" (grupo 14, índice
   11)** reaproveitado com `ItemLevel` indicando a variante — mesmo
   padrão já visto em "Bundle of Jewel of Bless" (`docs/INVENTORY_BYTE_FORMAT.md`,
   "Bug de exibição de quantidade"). Confirmado testando no MuMaker:
   level 8 = +1, sequencial até level 12 = +5.

Tabela final, canônica em `src/services/vipAutopickCatalog.js` /
`src/data/vipAutopickOptions.json` (curado à mão, **não gerado** do
`Item.txt` como o `itemDimensions.json`):

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

**Preço de cada tier** (confirmado com o usuário, semeado pela migration):
Vip = 60 Cash, Super Vip = 120 Cash, Mega Vip = 240 Cash — todos 30 dias.

## O que foi feito

- `migrations/0006_vip_plans.sql` — **não aplicada ainda**, mesma
  mecânica das anteriores (idempotente, revise antes de aplicar). Cria
  `WebVipPlans` (catálogo fixo, 3 linhas semeadas) e `WebVipPurchases`
  (histórico, FK só pra `MEMB_INFO` — **nunca** pra `Character`,
  aprendendo com o bug de FK documentado na Seção 5, já que VIP é da
  conta e nunca precisa de `Character` pra nada).
- `src/db/vipPlansRepository.js`, `src/db/vipPurchasesRepository.js`,
  `src/db/autopickRepository.js` (esta última contra a tabela
  `MEMB_AUTOPICK_ITEMS` já existente).
- `src/db/accountsRepository.js` ganhou `renewVip`/`revokeVip` — toda a
  lógica de soma de dias/reset de `VipStartDate` fica num único `UPDATE`
  atômico (mesmo espírito do `debitCash` atômico já existente).
- `POST /shop/purchase` com `catalogId: "vip:<id>"` — ver
  `docs/API_REFERENCE.md` pra contrato completo.
- `GET/PUT /account/autopick` — GET sempre disponível (mostra o que já
  foi salvo, mesmo sem ser Mega Vip agora); PUT exige `vip === 3` **no
  momento da chamada** (não guarda "já foi Mega Vip alguma vez").
- `POST /admin/accounts/:id/vip` — concede/estende (`tier` 1-3 + `days`)
  ou revoga (`tier: 0`, sem `days`).
- `GET/PATCH /admin/shop/vip-plans` — só lista e edita preço/ativo.
- `GET /shop/items` e `GET /shop/history` passam a incluir VIP no
  catálogo unificado e no histórico (`kind: "vip_plan"` / `type:
  "vip_purchase"`).
- Testes: `tests/vipRepositories.test.js` (texto de SQL dos repositórios
  novos — mesma lição de `tests/shopBundlesRepository.test.js`,
  documentada em `feedback_testing_limits`), casos novos em
  `tests/shop.test.js`, `tests/account.test.js`, `tests/admin.test.js`.

## Pendências / passos manuais seus

1. **Aplicar `migrations/0006_vip_plans.sql`** (revisar antes).
2. **Testar em conta de teste** antes de expor pra jogadores reais —
   comprar cada tier, comprar de novo (confirmar soma de dias), comprar
   Super Vip e conferir que os 2 itens fixos aparecem em
   `MEMB_AUTOPICK_ITEMS`, e testar `PUT /account/autopick` numa conta
   Mega Vip de teste. Nenhuma dessas escritas foi validada contra o
   banco real ainda (mesma exigência do CLAUDE.md já seguida pra
   Seção 5).
3. Se o `Item.txt`/tabela de itens do servidor mudar no futuro, a lista
   de `vipAutopickOptions.json` é **curada à mão** — não é regenerada
   automaticamente como `itemDimensions.json`. Se algum item da lista de
   12 for removido/renumerado no jogo, precisa atualizar esse arquivo
   manualmente.
