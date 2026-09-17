const AppError = require('../utils/AppError');
const itemDimensions = require('../data/itemDimensions.json');

/**
 * Primitivas do formato binário de 16 bytes/slot, compartilhadas entre
 * `Character.Inventory` (docs/INVENTORY_BYTE_FORMAT.md) e `warehouse.Items`
 * (docs/WAREHOUSE_BYTE_FORMAT.md) — mesmo layout de bytes, confirmado
 * empiricamente nas duas tabelas (mesma fórmula de `type`, mesmo critério
 * de slot vazio). Containers específicos (inventoryService, warehouseService)
 * só definem suas próprias dimensões de grade — a lógica de bytes/grid vive
 * aqui pra não duplicar (e não divergir) essa lógica frágil.
 */
const ITEM_DB_BYTE = 16;

function isSlotEmpty(slotBytes) {
  const byte0 = slotBytes[0];
  const byte7 = slotBytes[7];
  const byte9 = slotBytes[9];
  return byte0 === 0xff && (byte7 & 0x80) === 0x80 && (byte9 & 0xf0) === 0xf0;
}

/** Reconstrói o `type` (grupo*512 + índice) de um item já salvo. Inverso de `makeSimpleItemSlot`. */
function decodeItemType(slotBytes) {
  const byte0 = slotBytes[0];
  const byte7 = slotBytes[7];
  const byte9 = slotBytes[9];
  let type = byte0;
  type |= (byte9 & 0xf0) << 5;
  type |= byte7 & 0x80 ? 0x100 : 0;
  return type;
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

function getItemDimensions(itemGroup, itemIndex) {
  return itemDimensions[`${itemGroup}:${itemIndex}`] || null;
}

/**
 * Reconstrói a ocupação real de uma grade retangular de slots (largura x
 * altura), entendendo o footprint real de cada item — não só o slot
 * âncora (ver bug documentado em docs/INVENTORY_BYTE_FORMAT.md: um item
 * 2x2 só grava dados no slot âncora, as células cobertas continuam com
 * 16 bytes de 0xFF e não podem ser tratadas como espaço livre).
 *
 * `startSlot`/`width`/`height` descrevem a faixa retangular dentro do
 * buffer (ex: mochila do personagem é slots [12,75] numa grade 8x8; baú
 * da conta é slots [0,119] numa grade 8x15, sem faixa de equipamento a
 * excluir).
 *
 * Retorna `{ occupied, unknownItems }` — `occupied` é um array de
 * `width*height` booleans, `unknownItems` lista âncoras cujo grupo/índice
 * não está na tabela de dimensões (footprint desconhecido, não pode ser
 * tratado com segurança).
 */
function buildOccupancyGrid(buffer, { startSlot, width, height }) {
  const totalCells = width * height;
  const occupied = new Array(totalCells).fill(false);
  const unknownItems = [];

  for (let slot = startSlot; slot < startSlot + totalCells; slot++) {
    const offset = slot * ITEM_DB_BYTE;
    const slotBytes = buffer.subarray(offset, offset + ITEM_DB_BYTE);
    if (isSlotEmpty(slotBytes)) continue;

    const rel = slot - startSlot;
    const anchorRow = Math.floor(rel / width);
    const anchorCol = rel % width;
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
        if (row >= height || col >= width) continue; // footprint não deveria extrapolar a grade — ignora com segurança
        occupied[row * width + col] = true;
      }
    }
  }

  return { occupied, unknownItems };
}

/**
 * Todo item que a loja insere é sempre "simples" (jóia/box 1x1, ver
 * `makeSimpleItemSlot`). Se algum item cadastrado na loja não for 1x1 de
 * verdade (conferido contra Item.txt), a lógica de inserção não sabe
 * reservar o footprint extra — bloqueia ANTES de gastar Cash do jogador.
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

module.exports = {
  ITEM_DB_BYTE,
  isSlotEmpty,
  decodeItemType,
  makeSimpleItemSlot,
  getItemDimensions,
  buildOccupancyGrid,
  assertRedeemableAsSimpleItem,
};
