# Formato binário da coluna `warehouse.Items` (validado empiricamente)

Este documento descreve o layout da coluna `Items` (VARBINARY(1920)) da
tabela `warehouse` (baú da conta), **confirmado empiricamente** em
2026-09-17 comparando um dump hex antes/depois de depositar itens reais
no baú pelo client do jogo. Use isso como fonte da verdade ao implementar
qualquer escrita no baú — não redescubra isso do zero.

## Schema da tabela

```sql
CREATE TABLE [dbo].[warehouse](
    [AccountID] [varchar](10) NOT NULL,
    [Items] [varbinary](1920) NULL,
    [Money] [int] NULL,
    [EndUseDate] [smalldatetime] NULL,
    [DbVersion] [tinyint] NULL,
    [pw] [smallint] NULL,
    [VaultID] [int] NOT NULL,
    [Number] [int] NULL
) ON [PRIMARY]
```

- **Sem PK/índice único declarado** (confirmado via `sys.indexes` —
  `scripts/dumpWarehouse.js --schema`). Na prática, uma linha por conta,
  sempre com `VaultID = 0` (as 3 contas inspecionadas tinham exatamente
  isso — `Number` sempre `NULL`). `VaultID`/`Number` provavelmente
  suportam uma feature de aba extra de baú que não está em uso ativo
  neste core. **Não escreva com outro `VaultID` sem investigar mais.**
- Como não há constraint de unicidade no banco, qualquer código que possa
  criar uma linha nova precisa se proteger de corrida por conta própria
  (ver `warehouseRepository.ensureRowAndGetItems`, que usa
  `WITH (UPDLOCK, HOLDLOCK)` numa transação).
- **BUG CORRIGIDO (2026-09-17)**: a checagem de "a conta já tem uma linha?"
  filtrava também por `VaultID = 0`. Se a conta já tivesse uma linha com
  outro `VaultID`, o código concluía "não existe" e **inseria uma segunda
  linha duplicada**. A checagem certa é só por `AccountID` — insere
  apenas se não existir NENHUMA linha, e usa o `VaultID` real da linha
  encontrada (não presume 0) em toda leitura/escrita seguinte.
- `Money`, `EndUseDate`, `DbVersion`, `pw` não são tocados pela API além
  da criação inicial da linha (valores padrão confirmados com o usuário:
  `Money=0`, `EndUseDate=NULL`, `DbVersion=3`, `pw=0`).

## Constantes confirmadas

```
ITEM_DB_BYTE       = 16   // bytes por slot — MESMO formato do Character.Inventory
WAREHOUSE_SIZE     = 120  // 120 * 16 = 1920 bytes, confirmado via DATALENGTH(Items)
WAREHOUSE_WIDTH     = 8   // colunas da grade visual (mesma largura da mochila do personagem)
WAREHOUSE_HEIGHT    = 15  // linhas — confirmado pelo usuário (fonte do core), bate com 120/8
```

**Toda a faixa `[0, 119]` é área de armazenamento** — diferente de
`Character.Inventory`, o baú não tem slots de equipamento a evitar.

## Layout de cada slot (16 bytes) — idêntico ao `Character.Inventory`

Ver `docs/INVENTORY_BYTE_FORMAT.md` ("Layout de cada slot") para a tabela
completa de offsets — **o layout é o mesmo**, confirmado comparando um
item depositado no baú com o cálculo esperado pela fórmula de `type` já
validada para o personagem:

```
Horn of Uniria (grupo 13, índice 2) depositado no baú:
  hex observado: 0200ff000000000000d0000000000000
  byte0 (DBI_TYPE)          = 0x02  — bate com (13*512+2) & 0xFF
  byte7 (extensão de type)  = 0x00  — bate com bit8 do type (não setado)
  byte9 (extensão de type)  = 0xd0  — bate com ((type & 0x1E00) >> 5) & 0xF0
```

Slot vazio: mesmos 16 bytes de `0xFF`, mesmo critério de detecção
(`isSlotEmpty` em `src/services/itemSlotCodec.js`). Confirmado: um baú
recém-aberto tem os 120 slots inteiros com esse padrão, e depositar 2
itens (posições visuais "primeira" e "última") resultou em exatamente
slot 0 e slot 119 marcados como ocupados — confirma a indexação
sequencial linha-a-linha (row-major) da grade 8x15, igual à mochila.

## Reuso de código

A lógica de bytes/grid (`isSlotEmpty`, `decodeItemType`,
`makeSimpleItemSlot`, `buildOccupancyGrid`, `assertRedeemableAsSimpleItem`)
foi extraída para `src/services/itemSlotCodec.js`, compartilhada entre:

- `src/services/inventoryService.js` — só leitura agora (`Character.Inventory`,
  grade 8x8 nos slots 12-75, exclui equipamento 0-11).
- `src/services/warehouseService.js` — leitura e escrita (`warehouse.Items`,
  grade 8x15 nos slots 0-119, sem exclusão).

**Não duplique a lógica de bytes/grid em nenhum lugar novo** — se
precisar de outro container (ex: baú de guild), importe de
`itemSlotCodec.js` e só defina as dimensões da grade.

## Ferramenta de diagnóstico

`scripts/dumpWarehouse.js` (`npm run dump-warehouse -- --schema` ou
`-- <AccountID>`) — mesmo padrão do `dump-inventory`, útil pra investigar
discrepâncias entre o que a API grava e o que o client mostra no baú.

## Migração do resgate da loja: mochila → baú (2026-09-17)

O resgate de item/pacote da loja (Seção 5) gravava antes no
`Character.Inventory` (mochila do personagem, slots 12-75). Passou a
gravar no `warehouse.Items` (baú da conta, slots 0-119) — decisão do
usuário: o baú é maior e não tem risco de colidir com slots de
equipamento. Mudanças de contrato relevantes (ver `docs/API_REFERENCE.md`):

- `characterName` **removido** do body de `POST /shop/purchase` para
  `catalogId` `item:*`/`bundle:*` — não é mais necessário, o resgate é da
  conta.
- Resposta de resgate não inclui mais `characterName`.
- Erros renomeados: `INVENTORY_FULL` → `WAREHOUSE_FULL`,
  `INVENTORY_UNKNOWN_ITEM` → `WAREHOUSE_UNKNOWN_ITEM`.
- `WebItemRedemptions.CharacterName`/`WebBundleRedemptions.CharacterName`
  removidas (decisão do usuário — não importa manter o histórico de qual
  personagem estava selecionado). `migrations/0007_drop_redemption_character_name.sql`
  — **não aplicada ainda**. Código já não referencia mais essas colunas
  em lugar nenhum (INSERT/SELECT), então funciona igual antes ou depois
  da migration rodar.
- Conta que nunca abriu o baú no jogo: a API cria a linha automaticamente
  (`warehouseRepository.ensureRowAndGetItems`) em vez de bloquear — valores
  padrão confirmados com o usuário, ver seção "Schema da tabela" acima.
