# Formato binário da coluna `Character.Inventory` (validado empiricamente)

Este documento descreve o layout exato dos bytes da coluna `Inventory`
(tipo `VARBINARY`) da tabela `Character`, já **confirmado empiricamente**
comparando dumps hex antes/depois de ações reais no jogo. Use isso como
fonte da verdade ao implementar a inserção de itens pela loja — não
redescubra isso do zero.

## Constantes confirmadas

```
ITEM_DB_BYTE      = 16   // bytes por slot de item
INVENTORY_SIZE    = 108  // total de slots no array (108 * 16 = 1728 bytes,
                          // confirmado via DATALENGTH(Inventory) no SQL Server)
MAIN_INVENTORY_SIZE = 76 // equipamento (12) + mochila (64) = 76
MAX_SUBTYPE_ITEMS = 512  // multiplicador usado na fórmula do "type"
```

## ⚠️ Faixas de slot — CRÍTICO

| Faixa de slot | Uso | Pode escrever item de loja aqui? |
|---|---|---|
| 0 a 11 | Equipamento vestido (capacete, armadura, armas, anéis, etc.) | **NUNCA.** Escrever aqui causa itens "grudados"/bugados visualmente no personagem (já aconteceu em teste). |
| 12 a 75 | Mochila real (grade 8x8) | **Sim.** Único intervalo seguro para inserir itens da loja. |
| 76 a 107 | Área fora de `MAIN_INVENTORY_RANGE`, propósito não confirmado nesta investigação (possível baú extra/costume do Season 2.5) | **Não escrever sem investigar mais.** |

Ao procurar um slot vazio para inserir um item da loja, **sempre restrinja
a busca ao intervalo `[12, 75]` inclusive.**

## Layout de cada slot (16 bytes)

| Offset | Nome (macro original) | Conteúdo |
|---|---|---|
| 0 | `DBI_TYPE` | Byte baixo do `type` do item |
| 1 | `DBI_OPTION_DATA` | Level (bits 3-6), Luck/Option2 (bit 2), Option3 baixo (bits 0-1), Option1/Skill (bit 7) |
| 2 | `DBI_DUR` | Durabilidade **ou** quantidade empilhada, dependendo do tipo de item (ver observação abaixo) |
| 3 | `DBI_SERIAL1` | Serial do `m_Number` (byte mais significativo) |
| 4 | `DBI_SERIAL2` | Serial |
| 5 | `DBI_SERIAL3` | Serial |
| 6 | `DBI_SERIAL4` | Serial (byte menos significativo) |
| 7 | `DBI_NOPTION_DATA` | NewOption/Excelente (bits 0-5), Option3 alto (bit 6), extensão do type (bit 7) |
| 8 | `DBI_SOPTION_DATA` | SetOption |
| 9 | `DBI_OPTION380_DATA` | ItemOptionEx (bit 3), extensão do type (bits 4-7) |
| 10 | `DBI_JOH_DATA` | JewelOfHarmonyOption |
| 11-15 | (reservado) | **Confirmado como `0x00`** em todos os slots ocupados observados |

### Slot vazio

Um slot vazio é representado por **16 bytes de `0xFF`**. O critério de
detecção usado pelo gameserver (reaproveite exatamente este critério):

```js
function isSlotEmpty(slotBytes) {
  const byte0 = slotBytes[0];
  const byte7 = slotBytes[7];
  const byte9 = slotBytes[9];
  return byte0 === 0xFF && (byte7 & 0x80) === 0x80 && (byte9 & 0xF0) === 0xF0;
}
```

## Fórmula do `type` (grupo + índice do item)

```js
// Codificar (grupo/índice -> type completo)
function itemGet(group, index) {
  return group * 512 + index; // MAX_SUBTYPE_ITEMS = 512
}
```

Para reconstruir o `type` a partir dos bytes salvos (leitura, caso precise
no futuro):

```js
function decodeType(slotBytes) {
  const byte0 = slotBytes[0];
  const byte7 = slotBytes[7];
  const byte9 = slotBytes[9];

  let type = byte0;
  type |= (byte9 & 0xF0) * 32;
  type |= (byte7 & 0x80) * 2;

  return type;
}
```

## Montagem de um slot simples (jóia/box, sem opções especiais)

Validado em produção (com teste prévio em conta de teste) para itens do
grupo 14 (jóias, bundles). **Level controla variantes de quantidade em
alguns itens** (ex: "Bundle of Jewel of Bless" nível 0/1/2 pode
corresponder a 10/20/30 unidades — **teste empiricamente cada item antes
de cadastrar na loja**, não assuma a correspondência sem validar com
`dump_inventory_slots` equivalente em Node).

```js
function makeSimpleItemSlot({ itemGroup, itemIndex, quantity = 1, itemLevel = 0 }) {
  const ITEM_DB_BYTE = 16;
  const itemType = itemGroup * 512 + itemIndex;

  const slot = Buffer.alloc(ITEM_DB_BYTE, 0x00);

  slot[0] = itemType & 0xFF;                              // DBI_TYPE
  slot[1] = (itemLevel & 0x0F) << 3;                       // DBI_OPTION_DATA (level)
  slot[2] = Math.min(quantity, 255);                       // DBI_DUR (quantidade)
  slot[3] = 0;                                             // DBI_SERIAL1
  slot[4] = 0;                                             // DBI_SERIAL2
  slot[5] = 0;                                             // DBI_SERIAL3
  slot[6] = 0;                                             // DBI_SERIAL4
  slot[7] = (itemType & 0x100) ? 0x80 : 0x00;               // DBI_NOPTION_DATA (extensão type)
  slot[8] = 0;                                             // DBI_SOPTION_DATA
  slot[9] = ((itemType & 0x1E00) >> 5) & 0xF0;              // DBI_OPTION380_DATA (extensão type)
  slot[10] = 0;                                            // DBI_JOH_DATA
  // bytes 11-15 já são 0x00 por causa do Buffer.alloc

  return slot;
}
```

## Busca de slot vazio (restrita à mochila real)

```js
const BAG_START_SLOT = 12;
const BAG_END_SLOT = 76; // exclusivo
const ITEM_DB_BYTE = 16;

function findEmptyBagSlot(inventoryBuffer) {
  for (let n = BAG_START_SLOT; n < BAG_END_SLOT; n++) {
    const offset = n * ITEM_DB_BYTE;
    const slot = inventoryBuffer.subarray(offset, offset + ITEM_DB_BYTE);

    if (isSlotEmpty(slot)) {
      return n;
    }
  }
  return -1; // mochila cheia (dentro da faixa segura)
}
```

## Fluxo completo de inserção (pseudocódigo do que a rota deve fazer)

1. Ler `Inventory` do personagem via query parametrizada.
2. Validar `inventoryBuffer.length === ITEM_DB_BYTE * INVENTORY_SIZE`
   (1728 bytes) — se não bater, **abortar** e logar erro (não escrever em
   formato desconhecido).
3. Achar slot vazio com `findEmptyBagSlot` (restrito a 12-75).
4. Se `-1`, retornar erro "mochila cheia" para o usuário.
5. Montar os 16 bytes do item com `makeSimpleItemSlot`.
6. Substituir esse trecho no buffer (`Buffer.copy` ou slicing manual).
7. Gravar de volta via `UPDATE Character SET Inventory = @novoBuffer WHERE
   Name = @charName` (parametrizado).
8. Registrar em log de auditoria: conta, personagem, item, quantidade,
   timestamp, transação da loja associada.

## Ferramenta de diagnóstico (recomendado portar)

Antes de cadastrar qualquer item novo na loja, é fortemente recomendado
ter um script/rota de debug que imprime todos os slots não-vazios de um
personagem em hex legível (equivalente ao `dump_inventory_slots.py` já
usado nesta investigação), para comparar visualmente o resultado da
inserção contra um item pego manualmente no jogo. Isso foi o que permitiu
detectar e corrigir o bug de escrita em slot de equipamento nesta mesma
investigação.

## Histórico de bugs já encontrados (não repetir)

1. **Bug do slot de equipamento**: a primeira versão da busca de slot
   vazio varria do slot 0, e podia inserir um item da loja em um slot de
   equipamento vazio (0-11), causando um item bugado grudado no
   personagem. Corrigido restringindo a busca a `[12, 75]`. **Sempre
   restrinja a essa faixa.**
2. **Bug de exibição de quantidade**: setar `quantity` no byte `DBI_DUR`
   nem sempre resulta na quantidade exibida corretamente no client — para
   itens tipo "Bundle", a variante de quantidade é controlada pelo
   **level** (byte 1), não pelo byte de durabilidade. Sempre valide com
   dump antes/depois no client real.
