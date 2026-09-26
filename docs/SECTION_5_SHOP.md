# Seção 5 — Loja / Créditos (Efí) — concluída; Pix em produção desde 2026-09-26

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

### Bug corrigido em produção (relatado por você): DELETE de personagem crashava o gameserver

Depois de um resgate (item ou bundle), o personagem passava a **travar o
`DELETE`** no client do jogo, e o gameserver em C++ crashava nessa hora.
Personagens sem nenhum resgate deletavam normalmente.

**Causa**: as FKs `FK_WebItemRedemptions_Character` e
`FK_WebBundleRedemptions_Character` (migrations 0002/0004) apontam para
`Character(Name)` sem `ON DELETE` — o padrão do SQL Server é `NO ACTION`,
que **rejeita o DELETE com erro 547** quando existe qualquer linha de
resgate referenciando aquele personagem. O gameserver não trata esse erro
de SQL e crasha em vez de simplesmente falhar a exclusão.

**Correção**: `migrations/0005_fix_redemption_character_fk.sql` muda as
duas FKs para `ON DELETE SET NULL` — o personagem pode ser deletado
normalmente, e a linha de resgate continua existindo (conta, item/pacote,
preço, data) só com `CharacterName = NULL`, mantendo o histórico
financeiro/auditoria intacto. Isso exigiu tornar `CharacterName` nullable
nas duas tabelas (a migration já faz isso).

**✅ Aplicada e validada em produção (2026-09-16)**: confirmado via
`sys.foreign_keys`/`sys.columns` que as duas FKs estão com
`delete_referential_action_desc = 'SET_NULL'` e `CharacterName` nullable.
Testado também pelo caminho que originalmente reproduzia o crash: deletar
pelo client do jogo um personagem com histórico de resgate — funcionou
sem travar/crashar.

### Novas validações no resgate (item e bundle), pedidas por você

Duas checagens novas, feitas **antes** de debitar o Cash (nenhuma delas
debita e depois estorna — se falhar, nada muda no saldo):

1. **Personagem não pode estar online.** Não existe uma coluna de
   "personagem ativo" na tabela `Character` — a checagem usa
   `MEMB_STAT.ConnectStat = 1` pela conta (`accountsRepository.isAccountOnline`),
   assumindo que só um personagem por conta fica logado por vez (decisão
   sua). Erro: **409 `CHARACTER_ONLINE`**.
   ⚠️ `docs/SECTION_8_SERVER.md` já registrava que a confiabilidade de
   `MEMB_STAT.ConnectStat` nunca foi validada contra o banco real — vale
   confirmar isso também ao testar esta checagem.
2. **Mochila precisa ter espaço para TODOS os itens da compra** (1 para
   item avulso, N para bundle) antes de debitar — `inventoryService.findEmptyBagSlot`/
   `countEmptyBagSlots` chamado antes do débito, não só depois como
   fallback. Erro: **409 `INVENTORY_FULL`**.

### Bug corrigido em produção (achado testando a checagem acima): item da loja "sumia" sem aparecer na mochila

Ao testar a validação de espaço #2 acima, você reportou: deixou a mochila
de um personagem de teste com só 1 espaço visível livre, resgatou um
bundle de 2 itens, a API respondeu sucesso, mas a mochila continuava com
1 espaço livre no jogo — os itens "sumiram".

**Causa**: `findEmptyBagSlot`/`countEmptyBagSlots` liam a coluna
`Inventory` byte a byte, tratando **1 slot do array = 1 célula visual da
mochila**. Isso é verdade só para itens 1x1. Um item maior (ex: uma
armadura 2x2) ocupa várias células na grade 8x8 real, mas só grava dados
em **um** slot do array (a célula "âncora", canto superior esquerdo) — as
outras 3 células que ele cobre visualmente continuam com os 16 bytes de
"vazio" (`0xFF`) no banco, porque é o **client**, não o servidor, quem
impede o jogador de soltar outro item ali (usando a largura/altura real
do item, que o client conhece e o banco não guarda por instância). Nosso
scanner via essas células cobertas como livres e inseria o item da loja
bem ali — a escrita no banco funcionava, mas o client nunca desenhava um
ícone novo numa célula que já estava visualmente ocupada por outro item.

Diagnosticado com o script `scripts/dumpInventorySlots.js` (dump de bytes
+ status `MEMB_STAT`) comparando o array contra o que o jogo mostrava:
o array tinha só ~20 slots ocupados onde o jogo mostrava a mochila quase
cheia — a diferença batia exatamente com itens 2x2 no meio dos itens 1x1.

**Correção**: você forneceu `docs/inv/Item.txt` (tabela de itens do
client — colunas `X`/`Y` = largura/altura real de cada item). Isso virou
`src/data/itemDimensions.json`, gerado por
`node scripts/generateItemDimensions.js` (rode de novo sempre que o
`Item.txt` for atualizado). `inventoryService.js` ganhou:
- `decodeItemType`/`getItemDimensions` — descobre grupo/índice/tamanho de
  um item já salvo no array.
- `buildBagGrid` — reconstrói a ocupação real da grade 8x8 (não só do
  array), marcando toda célula coberta pelo footprint de cada item já
  presente, não só a âncora.
- `findEmptyBagSlot`/`countEmptyBagSlots` agora usam essa grade — nunca
  mais escolhem uma célula "vazia no array" que na verdade está coberta
  por um item maior vizinho. Se algum item da mochila não estiver na
  tabela de dimensões (footprint desconhecido), lançam
  **409 `INVENTORY_UNKNOWN_ITEM`** em vez de arriscar sobrescrever algo.
- `assertRedeemableAsSimpleItem` — chamado antes de debitar Cash pra
  qualquer item/componente de bundle: se o item cadastrado na loja não
  for 1x1 de verdade (conferido contra `Item.txt`), a compra é rejeitada
  com **500 `UNSUPPORTED_ITEM_FOOTPRINT`** em vez de repetir o mesmo bug
  na escrita (nossa lógica de inserção só sabe reservar 1 célula).

**Validado empiricamente** (mesmo método do bug original): reproduzido o
cenário exato (mochila com armaduras 2x2 misturadas + 1 espaço visível
livre) — o dump confirmou que a nova lógica calcula **exatamente 1
célula livre** e aponta o slot certo (não um fantasma coberto). Depois,
testado ponta a ponta pela rota real: com 2 slots livres de verdade, um
resgate de bundle (2 itens) caiu certinho nos dois espaços; com só 1
livre, a API bloqueou com `INVENTORY_FULL` **antes de debitar**, sem
inserir nada. Teste de regressão em `tests/inventoryService.test.js`
reproduz esse cenário (armadura 2x2 escondendo células) para não voltar
a quebrar silenciosamente.

⚠️ **Ainda em aberto**: a tabela de dimensões cobre os itens que estavam
em `docs/inv/Item.txt` no momento em que foi gerada. Se o servidor
adicionar itens novos (evento, season update) sem atualizar esse arquivo
e regenerar `itemDimensions.json`, um personagem com um desses itens novos
na mochila vai fazer o resgate falhar com `INVENTORY_UNKNOWN_ITEM` (seguro,
mas incômodo) até o arquivo ser atualizado.

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

## Adendo — Resgate migrado da mochila pro baú da conta (2026-09-17)

Decisão sua: resgate de item/pacote passou a gravar no **baú da conta**
(`warehouse.Items`) em vez do `Character.Inventory` (mochila do
personagem) — o baú é maior (120 slots vs. 64 da mochila) e não tem risco
de escrever em cima de slot de equipamento.

- **Formato investigado e validado empiricamente** antes de escrever
  qualquer coisa (mesmo método usado pro `Character.Inventory`: dump hex
  antes/depois de uma ação real no jogo) — ver
  `docs/WAREHOUSE_BYTE_FORMAT.md` pelo resultado completo. Confirmado:
  mesmo layout de 16 bytes/slot, grade 8x15 (120 slots), sem faixa de
  equipamento a excluir.
- Lógica de bytes/grid compartilhada extraída pra
  `src/services/itemSlotCodec.js` — `inventoryService.js` (mochila) e o
  novo `warehouseService.js` (baú) importam dela, não duplicam.
- `characterName` **removido** do contrato de `POST /shop/purchase` para
  `item:*`/`bundle:*` — resgate não pede mais personagem. Erros
  renomeados: `INVENTORY_FULL`→`WAREHOUSE_FULL`,
  `INVENTORY_UNKNOWN_ITEM`→`WAREHOUSE_UNKNOWN_ITEM`. Ver
  `docs/API_REFERENCE.md` atualizado e o prompt de sync que te passei.
- `warehouse` **não tem PK/índice único declarado** — conta que nunca
  abriu o baú no jogo não tem linha lá. A API cria a linha automaticamente
  na primeira compra (`warehouseRepository.ensureRowAndGetItems`, valores
  padrão confirmados com você: `Money=0`, `EndUseDate=NULL`,
  `DbVersion=3`, `pw=0`, `VaultID=0`), protegido contra corrida com
  `WITH (UPDLOCK, HOLDLOCK)` numa transação (não há constraint do banco
  pra confiar). **Bug que você encontrou e eu corrigi**: a checagem
  inicial de "a conta já tem linha?" filtrava também por `VaultID = 0`,
  então uma conta com linha em outro `VaultID` seria tratada como "sem
  baú" e ganharia uma linha duplicada. Corrigido pra checar só por
  `AccountID` e usar o `VaultID` real encontrado em toda leitura/escrita
  seguinte (ver `docs/WAREHOUSE_BYTE_FORMAT.md`).
- **`warehouse` em si não precisou de migration** — já existe em produção,
  criada fora desta API. Mas você pediu pra remover de vez
  `WebItemRedemptions.CharacterName`/`WebBundleRedemptions.CharacterName`
  (não se importa em perder esse histórico) — ver
  `migrations/0007_drop_redemption_character_name.sql` (**não aplicada
  ainda**). Código já não referencia mais essas colunas (INSERT/SELECT),
  então funciona igual antes ou depois da migration rodar.
- `charactersRepository.findOwnedCharacter/getInventoryBuffer/updateInventory`
  removidos (ficaram sem uso — a checagem de personagem não existe mais
  nesse fluxo).

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
8. ~~Aplicar `migrations/0005_fix_redemption_character_fk.sql`~~ —
   **feito e validado em 2026-09-16** (ver seção acima).
9. **Testar o resgate no baú de verdade, numa conta de teste**, antes de
   dar como pronto: comprar um item avulso, comprar um pacote, e conferir
   com `npm run dump-warehouse -- <AccountID>` que os slots batem com o
   que aparece no baú do client. O formato foi validado (ver adendo
   acima), mas o *fluxo completo pela API* (débito + inserção + histórico)
   ainda não foi exercitado ponta a ponta como foi feito pra mochila.
10. **Avisar o front-end** — contrato mudou (`characterName` removido,
    `slot` agora é posição no baú, erros renomeados). Prompt de sync no
    final desta resposta, pra você repassar.
11. **Aplicar `migrations/0007_drop_redemption_character_name.sql`**
    (revisar antes) — remove `CharacterName` de `WebItemRedemptions`/
    `WebBundleRedemptions` de vez (perde o histórico de qual personagem
    foi selecionado em resgates antigos — você confirmou que não se
    importa). Código já funciona sem essa coluna antes de aplicar.

## Próxima seção

Seção 6 (Suporte/Tickets) não tem "pergunte antes" — posso seguir direto.

## Adendo — Homologação Efí (2026-09-26)

- **Bug corrigido antes do primeiro teste real**: a Efí acrescenta `/pix`
  à URL de webhook cadastrada ao notificar (só a notificação de teste do
  cadastro vai para a URL "pura"). A rota só aceitava
  `/shop/payment/webhook/:secret` — toda confirmação de pagamento teria
  dado 404 e nenhum Cash seria creditado. Agora aceita também
  `/shop/payment/webhook/:secret/pix`.
- `npm run efi-homolog-check -- --env .env.homolog`: testa credenciais,
  certificado, criação de cobrança (R$ 0,01), QR Code e confirmação
  automática da homologação, usando o mesmo `efiClient.js` da API.
  **Não toca no banco.** Recusa rodar com `EFI_SANDBOX` diferente de
  `true`. Opção: `--webhook`.
- **Chave Pix em homologação**: a Efí não cria nem lista chaves nesse
  ambiente (`/v2/gn/evp` só funciona em produção — retorna
  `erro_aplicacao`/`erro_interno_servidor`). Qualquer chave com formato
  válido serve em `EFI_PIX_KEY` (ex: a chave real da conta Efí).
- Em homologação, cobranças de R$ 0,01 a R$ 10,00 são confirmadas
  automaticamente pela Efí (com webhook); acima disso ficam `ATIVA`.
- Com o deploy definido (nginx termina o TLS, Node só em 127.0.0.1), o
  mTLS do webhook passa a ser viável no nginx — ver plano no chat /
  próximo adendo.

## Adendo — Webhook em homologação validado + checklist de virada (2026-09-26)

Validado em homologação, na própria API de produção (servidor ainda sem
jogadores — decisão do usuário):
- `npm run efi-homolog-check`: cobrança, QR Code e confirmação automática OK.
- mTLS no nginx (`/etc/nginx/sites-available/mu-api`): `ssl_verify_client
  optional` + `ssl_client_certificate /etc/nginx/efi/efi-chain-homolog.crt`
  no server 443, e `location /api/v1/shop/payment/webhook/` que devolve 403
  se `$ssl_client_verify != SUCCESS`. Rotas normais e o site não mudam.
- `npm run efi-webhook -- register https://api.mupro.vip`: a Efí testou a
  URL (primeiro sem certificado → 403 esperado, depois com → 200) e aceitou.
- Compra real pelo site: webhook chegou em `.../webhook/<segredo>/pix` → 200.

**Checklist para virar para produção** (itens 1–4 feitos em 2026-09-26 — ver adendo seguinte):
1. `.env`: `EFI_SANDBOX=false`, Client ID/Secret de **Produção**,
   `EFI_CERTIFICATE_PATH` → `.p12` de **produção**, `EFI_PIX_KEY` → chave
   Pix real da conta Efí (escopos marcados também na aba Produção).
2. **Novo** `EFI_WEBHOOK_SECRET` (`openssl rand -hex 32`) — o de
   homologação apareceu em logs e no chat.
3. nginx: baixar `certificate-chain-prod.crt` e trocar o
   `ssl_client_certificate` para ele (não manter a cadeia de homologação).
   `sudo nginx -t && sudo systemctl reload nginx`.
4. `pm2 restart` (o aviso "Efí em HOMOLOGAÇÃO" some do log) e
   `npm run efi-webhook -- register https://api.mupro.vip`.
5. Limpar dados de teste: Cash da conta de teste, linhas de teste em
   `WebPixCharges`, pacote "Teste Pix" (desativar).
6. Opcional: `access_log off;` (ou formato sem path) no `location` do
   webhook no nginx, para o segredo não ficar no access.log.

**Crédito atômico (2026-09-26):** `processPixNotification` usava dois
comandos separados (`markPaid`, depois `creditCash`) — falha entre eles
deixava a cobrança "paga" sem Cash, e os reenvios da Efí não corrigiam.
Substituído por `pixChargesRepository.markPaidAndCredit` (uma transação;
conta inexistente → rollback e a cobrança segue pending). Revalidado em
homologação com nova compra de teste.

## Adendo — Efí em produção (2026-09-26)

Virada feita e validada com dinheiro real:
- `.env`: `EFI_SANDBOX=false`, credenciais e `.p12` de produção, chave Pix
  real da conta, **novo** `EFI_WEBHOOK_SECRET`.
- nginx: `ssl_client_certificate /etc/nginx/efi/efi-chain-prod.crt`.
- `npm run efi-webhook -- register https://api.mupro.vip` → Efí de produção
  validou a URL (mTLS com a cadeia de produção + 200).
- Pagamento real de R$ 0,01 (pacote `credit:4 "teste api"`) pago pelo app
  do banco → confirmado na tela e Cash creditado.

Ainda em aberto (itens 5 e 6 do checklist acima):
- Desativar `credit:4 "teste api"` antes de abrir o servidor — em produção
  ele vende 100 Cash por R$ 0,01 de verdade.
- Limpar Cash das contas usadas nos testes.
- Opcional: `access_log off;` no `location` do webhook no nginx.
