const AppError = require('../utils/AppError');
const itemDimensions = require('../data/itemDimensions.json');

/**
 * Lógica de inserção de item no Inventory (VARBINARY) do personagem.
 * Porta direta do que está validado empiricamente em
 * docs/INVENTORY_BYTE_FORMAT.md — não altere estas constantes/fórmulas
 * sem atualizar aquele documento e revalidar em conta de teste.
 */
const ITEM_DB_BYTE = 16;
const INVENTORY_SIZE = 108;
const BAG_START_SLOT = 12;
const BAG_END_SLOT = 76; // exclusivo — NUNCA escrever fora de [12, 75]
const BAG_WIDTH = 8; // colunas da grade visual da mochila (8x8 = 64 células)
const BAG_HEIGHT = (BAG_END_SLOT - BAG_START_SLOT) / BAG_WIDTH; // 8 linhas

function isSlotEmpty(slotBytes) {
  const byte0 = slotBytes[0];
  const byte7 = slotBytes[7];
  const byte9 = slotBytes[9];
  return byte0 === 0xff && (byte7 & 0x80) === 0x80 && (byte9 & 0xf0) === 0xf0;
}

/**
 * Reconstrói o `type` (grupo*512 + índice) de um item já salvo, a partir
 * dos bytes do slot. Inverso de `makeSimpleItemSlot` — ver
 * docs/INVENTORY_BYTE_FORMAT.md ("Fórmula do type").
 */
function decodeItemType(slotBytes) {
  const byte0 = slotBytes[0];
  const byte7 = slotBytes[7];
  const byte9 = slotBytes[9];
  let type = byte0;
  type |= (byte9 & 0xf0) << 5;
  type |= (byte7 & 0x80) ? 0x100 : 0;
  return type;
}

function getItemDimensions(itemGroup, itemIndex) {
  return itemDimensions[`${itemGroup}:${itemIndex}`] || null;
}

/**
 * BUG DE PRODUÇÃO (ver docs/SECTION_5_SHOP.md): um item com footprint
 * maior que 1x1 (ex: uma armadura 2x2) ocupa várias células visuais da
 * mochila, mas só grava dados reais no slot "âncora" (canto superior
 * esquerdo) — as outras células que ele cobre continuam com os 16 bytes
 * de "vazio" (0xFF) no array, porque o client (não o servidor) é quem
 * impede o jogador de soltar outro item ali, usando a largura/altura do
 * item vinda de Item.txt. Um scanner que olhe só byte a byte (sem saber
 * o footprint de cada item já presente) confunde essas células cobertas
 * com espaço livre de verdade — foi exatamente isso que causou itens da
 * loja "sumirem" ao serem inseridos por cima de um item maior.
 *
 * `buildBagGrid` reconstrói a ocupação real da grade 8x8 (linhas x
 * colunas, começando em BAG_START_SLOT) usando `src/data/itemDimensions.json`
 * (gerado de docs/inv/Item.txt via `npm run generate-item-dimensions`).
 *
 * Retorna:
 *  - `occupied`: array de 64 booleans (índice = (slot - BAG_START_SLOT)),
 *    true = célula coberta por algum item (âncora ou footprint estendido).
 *  - `unknownItems`: âncoras cujo grupo/índice não está na tabela de
 *    dimensões — nesses casos NÃO sabemos o footprint real, então
 *    qualquer função que use o grid deve tratar isso como "não posso
 *    garantir espaço livre com segurança" (ver `assertGridIsReliable`).
 */
function buildBagGrid(inventoryBuffer) {
  const totalCells = BAG_WIDTH * BAG_HEIGHT;
  const occupied = new Array(totalCells).fill(false);
  const unknownItems = [];

  for (let slot = BAG_START_SLOT; slot < BAG_END_SLOT; slot++) {
    const offset = slot * ITEM_DB_BYTE;
    const slotBytes = inventoryBuffer.subarray(offset, offset + ITEM_DB_BYTE);
    if (isSlotEmpty(slotBytes)) continue;

    const rel = slot - BAG_START_SLOT;
    const anchorRow = Math.floor(rel / BAG_WIDTH);
    const anchorCol = rel % BAG_WIDTH;
    occupied[rel] = true;

    const type = decodeItemType(slotBytes);
    const itemGroup = Math.floor(type / 512);
    const itemIndex = type % 512;
    const dims = getItemDimensions(itemGroup, itemIndex);

    if (!dims) {
      unknownItems.push({ slot, itemGroup, itemIndex });
      continue;
    }

    for (let dRow = 0; dRow < dims.height; dRow++) {
      for (let dCol = 0; dCol < dims.width; dCol++) {
        const row = anchorRow + dRow;
        const col = anchorCol + dCol;
        if (row >= BAG_HEIGHT || col >= BAG_WIDTH) continue; // footprint não deveria extrapolar a grade — ignora com segurança
        occupied[row * BAG_WIDTH + col] = true;
      }
    }
  }

  return { occupied, unknownItems };
}

/**
 * Todo item que a loja insere é sempre "simples" (jóia/box 1x1, ver
 * `makeSimpleItemSlot`). Se algum item cadastrado na loja não for 1x1 de
 * verdade (conferido contra Item.txt), nossa lógica de inserção não sabe
 * reservar o footprint extra — bloqueia ANTES de gastar Cash do jogador,
 * em vez de repetir o mesmo bug de itens "sumidos".
 */
function assertRedeemableAsSimpleItem(itemGroup, itemIndex) {
  const dims = getItemDimensions(itemGroup, itemIndex);
  if (!dims || dims.width !== 1 || dims.height !== 1) {
    throw new AppError(
      500,
      'UNSUPPORTED_ITEM_FOOTPRINT',
      `Item grupo=${itemGroup} índice=${itemIndex} não é 1x1 (${dims ? `${dims.width}x${dims.height}` : 'dimensão desconhecida'}) — inserção pela loja só suporta itens simples 1x1.`,
    );
  }
}

function assertGridIsReliable(unknownItems) {
  if (unknownItems.length > 0) {
    throw new AppError(
      409,
      'INVENTORY_UNKNOWN_ITEM',
      'A mochila deste personagem tem um item que não reconhecemos (fora da tabela de dimensões) — abortando para não arriscar sobrescrever ou perder itens.',
    );
  }
}

/** Usado para validar espaço ANTES de debitar créditos (0 a N itens de uma vez). */
function countEmptyBagSlots(inventoryBuffer) {
  const { occupied, unknownItems } = buildBagGrid(inventoryBuffer);
  assertGridIsReliable(unknownItems);
  return occupied.filter((cell) => !cell).length;
}

function findEmptyBagSlot(inventoryBuffer) {
  const { occupied, unknownItems } = buildBagGrid(inventoryBuffer);
  assertGridIsReliable(unknownItems);
  const rel = occupied.indexOf(false);
  return rel === -1 ? -1 : BAG_START_SLOT + rel;
}

function makeSimpleItemSlot({ itemGroup, itemIndex, quantity = 1, itemLevel = 0 }) {
  const itemType = itemGroup * 512 + itemIndex;
  const slot = Buffer.alloc(ITEM_DB_BYTE, 0x00);

  slot[0] = itemType & 0xff; // DBI_TYPE
  slot[1] = (itemLevel & 0x0f) << 3; // DBI_OPTION_DATA (level)
  slot[2] = Math.min(quantity, 255); // DBI_DUR (quantidade)
  slot[7] = itemType & 0x100 ? 0x80 : 0x00; // DBI_NOPTION_DATA (extensão type)
  slot[9] = ((itemType & 0x1e00) >> 5) & 0xf0; // DBI_OPTION380_DATA (extensão type)

  return slot;
}

/**
 * Insere um item na mochila real do personagem (slots 12-75), nunca em
 * slots de equipamento. Retorna um NOVO buffer (não muta o original) e o
 * índice do slot usado. `itemSpec` precisa ser 1x1 (ver
 * `assertRedeemableAsSimpleItem` — chame antes de debitar Cash).
 */
function insertItemIntoInventory(inventoryBuffer, itemSpec) {
  if (!Buffer.isBuffer(inventoryBuffer) || inventoryBuffer.length !== ITEM_DB_BYTE * INVENTORY_SIZE) {
    throw new AppError(
      500,
      'INVALID_INVENTORY_FORMAT',
      'Formato do inventário do personagem não reconhecido — abortando para não corromper dados.',
    );
  }

  const slotIndex = findEmptyBagSlot(inventoryBuffer);
  if (slotIndex === -1) {
    throw new AppError(409, 'INVENTORY_FULL', 'Mochila cheia. Libere espaço antes de resgatar este item.');
  }

  const itemSlotBytes = makeSimpleItemSlot(itemSpec);
  const newBuffer = Buffer.from(inventoryBuffer);
  itemSlotBytes.copy(newBuffer, slotIndex * ITEM_DB_BYTE);

  return { buffer: newBuffer, slot: slotIndex };
}

/**
 * Insere vários itens de uma vez (pacote/bundle) — cada entrada de
 * `itemSpecs` ocupa seu próprio slot da mochila (12-75), sempre 1x1.
 * Tudo ou nada: o buffer original só é lido, a escrita acontece num
 * buffer novo, e se faltar espaço para QUALQUER item da lista a função
 * lança antes de devolver nada — quem chamar não deve persistir nem
 * debitar em caso de erro (mesmo padrão de rollback do
 * insertItemIntoInventory).
 */
function insertItemsIntoInventory(inventoryBuffer, itemSpecs) {
  if (!Buffer.isBuffer(inventoryBuffer) || inventoryBuffer.length !== ITEM_DB_BYTE * INVENTORY_SIZE) {
    throw new AppError(
      500,
      'INVALID_INVENTORY_FORMAT',
      'Formato do inventário do personagem não reconhecido — abortando para não corromper dados.',
    );
  }

  const newBuffer = Buffer.from(inventoryBuffer);
  const slots = [];

  for (const itemSpec of itemSpecs) {
    const slotIndex = findEmptyBagSlot(newBuffer);
    if (slotIndex === -1) {
      throw new AppError(
        409,
        'INVENTORY_FULL',
        'Mochila cheia. Espaço insuficiente para todos os itens do pacote — nada foi alterado.',
      );
    }
    const itemSlotBytes = makeSimpleItemSlot(itemSpec);
    itemSlotBytes.copy(newBuffer, slotIndex * ITEM_DB_BYTE);
    slots.push(slotIndex);
  }

  return { buffer: newBuffer, slots };
}

module.exports = {
  ITEM_DB_BYTE,
  INVENTORY_SIZE,
  BAG_START_SLOT,
  BAG_END_SLOT,
  BAG_WIDTH,
  BAG_HEIGHT,
  isSlotEmpty,
  decodeItemType,
  getItemDimensions,
  buildBagGrid,
  assertRedeemableAsSimpleItem,
  findEmptyBagSlot,
  countEmptyBagSlots,
  makeSimpleItemSlot,
  insertItemIntoInventory,
  insertItemsIntoInventory,
};
