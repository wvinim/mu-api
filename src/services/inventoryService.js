const AppError = require('../utils/AppError');

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

function isSlotEmpty(slotBytes) {
  const byte0 = slotBytes[0];
  const byte7 = slotBytes[7];
  const byte9 = slotBytes[9];
  return byte0 === 0xff && (byte7 & 0x80) === 0x80 && (byte9 & 0xf0) === 0xf0;
}

function findEmptyBagSlot(inventoryBuffer) {
  for (let n = BAG_START_SLOT; n < BAG_END_SLOT; n++) {
    const offset = n * ITEM_DB_BYTE;
    const slot = inventoryBuffer.subarray(offset, offset + ITEM_DB_BYTE);
    if (isSlotEmpty(slot)) return n;
  }
  return -1;
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
 * índice do slot usado.
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
 * `itemSpecs` ocupa seu próprio slot da mochila (12-75). Tudo ou nada:
 * o buffer original só é lido, a escrita acontece num buffer novo, e se
 * faltar espaço para QUALQUER item da lista a função lança antes de
 * devolver nada — quem chamar não deve persistir nem debitar em caso de
 * erro (mesmo padrão de rollback do insertItemIntoInventory).
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
  isSlotEmpty,
  findEmptyBagSlot,
  makeSimpleItemSlot,
  insertItemIntoInventory,
  insertItemsIntoInventory,
};
