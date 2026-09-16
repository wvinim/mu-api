# Seção 5 — Loja / Créditos (Efí) — concluída, não testada contra a API real

> `npm test` inicialmente falhava: 1) faltava rodar `npm install` depois
> da dependência nova (`sdk-node-apis-efi`); 2) o rate limit de
> compra (1 req/3s) estava bloqueando os próprios testes, rodando várias
> chamadas de `/shop/purchase` em sequência. Corrigido tornando o limite
> configurável (`RATE_LIMIT_PURCHASE_MAX`/`_WINDOW_SECONDS`) e relaxando
> no teste, mesmo padrão já usado para o rate limit de login. Suíte
> completa passando agora — mas isso valida só a lógica (banco mockado),
> não a integração real com a Efí.

**Não posso confirmar que isto funciona ponta a ponta.** Você ainda não
tem credenciais de sandbox da Efí, então o código foi escrito com base na
documentação oficial e no código-fonte de exemplo do SDK
(`sdk-node-apis-efi`, pacote oficial no npm), mas **nunca foi executado
contra a API deles**. Trate como "pronto para revisão", não como
"validado" — validação real só quando você tiver as credenciais.

## Modelo de negócio (confirmado com você)

Dois passos, não um:
1. **Pix → Cash**: jogador compra um "pacote de créditos" (`WebCreditPackages`)
   via Pix. Confirmado o pagamento, credita `MEMB_INFO.Cash`.
2. **Cash → item**: jogador gasta Cash para resgatar um item do catálogo
   (`WebShopItems`), que é inserido na mochila do personagem usando
   exatamente a lógica de `docs/INVENTORY_BYTE_FORMAT.md`.

## O que foi feito

- `GET /api/v1/shop/items` — catálogo público único combinando pacotes de
  crédito (`catalogId: "credit:<id>"`) e itens resgatáveis
  (`catalogId: "item:<id>"`).
- `GET /api/v1/shop/items/:id` — detalhe de uma entrada do catálogo.
- `POST /api/v1/shop/purchase` (autenticado, rate limit 1 req/3s por
  conta) — `{ catalogId }` para comprar créditos (cria cobrança Pix,
  devolve QR code/copia-e-cola) ou `{ catalogId, characterName }` para
  resgatar um item (debita Cash atomicamente, insere no inventário).
- `GET /api/v1/shop/credits` — saldo atual de `Cash`.
- `GET /api/v1/shop/history` — histórico unificado (compras de crédito +
  resgates de item) com paginação real via `ROW_NUMBER()` sobre um
  `UNION ALL` das duas tabelas.
- `POST /api/v1/shop/payment/webhook/:secret` — recebe a notificação da
  Efí. **Nunca credita com base só no payload**: sempre reconsulta a
  cobrança pelo `txid` direto na API da Efí (autenticado com nosso
  certificado) antes de creditar. Idempotente via
  `WebPixCharges.Status` (só credita se a atualização para `'paid'`
  realmente mudou uma linha ainda `'pending'`).
- Inserção no inventário: porta direta de `docs/INVENTORY_BYTE_FORMAT.md`
  em `src/services/inventoryService.js` — restrita a slots 12-75, nunca
  toca 0-11. Se a mochila estiver cheia, os créditos debitados são
  estornados automaticamente.
- Débito de Cash atômico (`WHERE Cash >= @amount` no mesmo `UPDATE`) —
  evita gasto duplo em cliques simultâneos.
- Log de auditoria de toda transação (`shop.pix_charge_created`,
  `shop.pix_payment_confirmed`, `shop.item_redeemed`).
- Migration `migrations/0002_shop_tables.sql` (4 tabelas novas:
  `WebCreditPackages`, `WebShopItems`, `WebPixCharges`,
  `WebItemRedemptions`) — **não aplicada**, mesma mecânica de
  collation dinâmica da 0001.
- Testes Jest + Supertest (`tests/shop.test.js`), incluindo um teste que
  confirma que os slots de equipamento (bytes 0-191, slots 0-11) nunca
  são tocados, e que a mochila cheia estorna os créditos.

## ⚠️ Segurança do webhook — limitação conhecida, decisão pendente sua

A Efí **exige mTLS no seu endpoint de webhook** (norma do Banco Central):
seu servidor precisa apresentar/validar certificado cliente na conexão.
Isso depende de **onde o TLS é terminado** — decisão que o CLAUDE.md
deixou para a etapa de deploy (IIS+ARR vs Caddy). Por isso, hoje:

- O endpoint é protegido só por um **segredo na URL**
  (`EFI_WEBHOOK_SECRET`, comparado com `timingSafeEqual`) — dificulta
  chamadas forjadas, mas não é mTLS de verdade.
- A proteção real contra crédito indevido é **não confiar no payload**:
  todo webhook dispara uma reconsulta autenticada à Efí pelo `txid`, e só
  credita se a Efí confirmar `status: "CONCLUIDA"`. Mesmo que alguém
  descubra a URL do webhook e mande um payload falso, isso só aciona uma
  consulta — não credita nada sozinho.
- **Quando decidirmos o reverse proxy (deploy)**, revisar se dá para
  também aplicar mTLS/allowlist de IP da Efí (`34.193.116.226`, mas
  **confirme o IP atual na documentação deles antes de usar** — IPs de
  provedores mudam) na frente do webhook.

## Adendo — Pacotes de itens (bundles)

Pedido seu: vender vários itens do catálogo juntos, num produto só (ex:
"10x Jewel Pack + 10x Kundun Box" por um preço fixo), sem precisar expor
cada item individualmente na loja.

- **Modelo escolhido**: um bundle **referencia itens que já existem em
  `WebShopItems`** (você continua cadastrando "Jewel Pack" e "Kundun Box"
  exatamente como já fazia, cada um já validado empiricamente conforme
  `docs/INVENTORY_BYTE_FORMAT.md`) — não duplica grupo/índice/level em
  outro lugar. O bundle só guarda **quantas instâncias de cada item
  conceder**.
- **Pra não vender o item avulso**: marque o item componente com
  `active: false` no `PATCH /admin/shop/items/:id` de sempre. Ele some do
  catálogo avulso (`GET /shop/items`) e não pode mais ser comprado via
  `catalogId: "item:<id>"`, mas continua funcionando normalmente como
  componente de um bundle (a busca de componente não filtra por `Active`
  — só o bundle em si precisa estar ativo).
- **Novo `catalogId`**: `"bundle:<id>"`, aparece em `GET /shop/items` /
  `GET /shop/items/:id` misturado com `credit:*` e `item:*`
  (`kind: "item_bundle"`), com `items: [{ name, quantity }]` mostrando o
  conteúdo pro comprador.
- **Compra** (`POST /shop/purchase` com `catalogId: "bundle:<id>"` +
  `characterName`): debita o **preço do bundle** (não a soma dos itens —
  dá pra vender com desconto ou ágio em relação ao preço avulso), depois
  insere **cada instância de cada componente num slot da mochila
  separado** (2x Jewel Pack + 3x Kundun Box = 5 slots, cada um do jeito
  que já era inserido individualmente). **Tudo ou nada**: se não houver
  espaço pra todos os itens do pacote, nada é gravado no `Inventory` e o
  Cash debitado é estornado automaticamente (mesmo padrão de estorno já
  usado pra item avulso) — nunca entrega metade de um pacote.
- **Auditoria**: uma linha só em `WebBundleRedemptions` por compra (preço
  do pacote), com o detalhe de quais itens/slots entraram no
  `WebAuditLog` (`eventType: 'shop.bundle_redeemed'`) — não uma linha por
  item, pra não conflitar com o preço individual de cada componente
  (que pode nem fazer sentido fora do contexto do bundle).
- `GET /shop/history` agora também lista compras de bundle
  (`type: "bundle_redemption"`), unificado com `credit_purchase` e
  `item_redemption` no mesmo `UNION ALL`.

### Admin (CRUD de bundles)

- `GET/POST /admin/shop/bundles` — POST:
  `{ name, description?, priceCredits, active?, items: [{ shopItemId, quantity }] }`
  (`items` não pode ser vazio).
- `PATCH /admin/shop/bundles/:id` — qualquer subconjunto dos campos
  acima. **Se `items` for enviado, substitui a lista inteira** (não faz
  merge/diff com o que já existia) — mais previsível pra editar do que
  tentar adivinhar adição/remoção implícita.
- `DELETE /admin/shop/bundles/:id` — soft-delete (`active = false`).

### Bug corrigido (relatado pelo front, contra o banco real)

`GET /admin/shop/bundles` retornava erro do SQL Server: *"A column has
been specified more than once in the order by list."* Causa: o `JOIN` de
`WebShopBundles` + `WebShopBundleItems` + `WebShopItems` junta três
tabelas que **cada uma tem sua própria coluna chamada `Id`**, e o
`ORDER BY` ordenava por `bi.Id` (a PK de `WebShopBundleItems`) sem esse
campo nunca ter sido incluído no `SELECT`. Os testes automatizados desse
endpoint mockam o repositório inteiro (não rodam SQL de verdade), por
isso isso só apareceu contra o banco real — bug real, não coberto pela
suíte até então.

Corrigido em `src/db/shopBundlesRepository.js`: agora sempre seleciona a
PK de cada tabela envolvida com um alias próprio (`ComponentId`/
`componentId`) e o `ORDER BY` referencia só esses aliases, nunca
`tabela.Id` qualificado — elimina a ambiguidade de vez, não só nesse
`SELECT` específico. Adicionado `tests/shopBundlesRepository.test.js` que
inspeciona o texto da query pra travar essa regra (confirmado que ele
falha se alguém reintroduzir `ORDER BY b.Id, bi.Id`).

### Schema novo

`migrations/0004_shop_bundles.sql` — **não aplicada**, mesma mecânica das
anteriores (idempotente, revise antes). Três tabelas novas, nenhuma
alteração em tabela existente:
- `WebShopBundles` — o produto (nome, descrição, preço, active).
- `WebShopBundleItems` — a composição (`BundleId` + `ShopItemId` +
  `Quantity`, com FK pra `WebShopItems` — não duplica dado do item).
- `WebBundleRedemptions` — uma linha por compra de bundle (mesmo espírito
  de `WebItemRedemptions`, mas 1:1 com a compra, não 1:1 com o item
  concedido).

## Decisões técnicas (não pedidas explicitamente)

- **SDK oficial usado**: `sdk-node-apis-efi` (conforme preferência do
  CLAUDE.md por SDK oficial).
- **Não colhemos CPF/nome do pagador** (`devedor` na cobrança Pix) — não
  existe esse campo no cadastro do site hoje. É opcional na API da Efí;
  fácil de adicionar depois se você quiser.
- **`WebShopItems` guarda a "receita" do item** (grupo/índice/level/
  quantidade), não os bytes prontos — mais fácil de o admin (Seção 7)
  cadastrar/editar do que bytes crus.
- Preço de pacote de créditos em **centavos** (`PriceCents`, inteiro) —
  evita problema de ponto flutuante com dinheiro.

## Pendências / passos manuais seus

1. **Aplicar `migrations/0002_shop_tables.sql`** (revisar antes).
2. **Credenciais Efí**: `EFI_CLIENT_ID`, `EFI_CLIENT_SECRET`,
   `EFI_CERTIFICATE_PATH` (caminho do `.p12`), `EFI_PIX_KEY` (sua chave
   Pix cadastrada na Efí) — direto no `.env`, nunca me cole os valores.
3. **`EFI_WEBHOOK_SECRET`** — gere uma string aleatória longa e configure
   também no painel da Efí (ou via `pixConfigWebhook`) apontando para
   `https://seu-dominio/api/v1/shop/payment/webhook/<esse-segredo>`. Só
   dá para configurar de verdade depois que o domínio/deploy estiverem
   prontos.
4. **Cadastrar o catálogo manualmente por enquanto** — não existe admin
   CRUD ainda (isso é Seção 7). Exemplo de INSERT para testar:
   ```sql
   INSERT INTO WebCreditPackages (Name, PriceCents, CreditsAmount, Active)
   VALUES ('1000 Créditos', 1000, 1000, 1); -- R$ 10,00 = 1000 Cash

   INSERT INTO WebShopItems (Name, Description, PriceCredits, ItemGroup, ItemIndex, ItemLevel, Quantity, Active)
   VALUES ('Bundle of Jewel of Bless (10x)', 'Pacote de joia de bless', 500, 14, 13, 0, 10, 1);
   -- ⚠️ confirme grupo/índice/level/quantidade reais testando em conta de
   -- teste com dump de inventário antes/depois, conforme o próprio
   -- docs/INVENTORY_BYTE_FORMAT.md recomenda — não copie este exemplo
   -- sem validar.
   ```
5. **Testar em conta de teste antes de expor a rota em produção**
   (exigência explícita do CLAUDE.md) — assim que tiver credenciais
   sandbox, faça uma compra de créditos de valor mínimo e um resgate de
   item num personagem de teste, e confira o dump do `Inventory` antes/
   depois.
6. Rodar `npm install` (novo pacote `sdk-node-apis-efi`) e `npm test`.
7. **Aplicar `migrations/0004_shop_bundles.sql`** (revisar antes) — cria
   `WebShopBundles`, `WebShopBundleItems`, `WebBundleRedemptions` pro
   recurso de pacotes/bundles (ver adendo acima).

## Próxima seção

Seção 6 (Suporte/Tickets) não tem "pergunte antes" — posso seguir direto.
