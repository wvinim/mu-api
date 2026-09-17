const codec = require('./itemSlotCodec');

/**
 * Leitura do `Inventory` (VARBINARY) do personagem. Escrita pela loja foi
 * migrada pro baú da conta (`warehouse.Items`, ver `warehouseService.js` e
 * docs/WAREHOUSE_BYTE_FORMAT.md) — este módulo agora é só leitura, usado
 * por `scripts/dumpInventorySlots.js` e reservado pra uma futura rota
 * `GET /characters/:name/inventory` (Seção 4). Layout de bytes documentado
 * em docs/INVENTORY_BYTE_FORMAT.md, validado empiricamente.
 */
const { ITEM_DB_BYTE } = codec;
const INVENTORY_SIZE = 108;
const BAG_START_SLOT = 12;
const BAG_END_SLOT = 76; // exclusivo — faixa real da mochila, fora do equipamento (0-11)
const BAG_WIDTH = 8; // colunas da grade visual da mochila (8x8 = 64 células)
const BAG_HEIGHT = (BAG_END_SLOT - BAG_START_SLOT) / BAG_WIDTH; // 8 linhas

/** Ver `itemSlotCodec.buildOccupancyGrid` — aqui só fixa as dimensões da mochila do personagem. */
function buildBagGrid(inventoryBuffer) {
  return codec.buildOccupancyGrid(inventoryBuffer, { startSlot: BAG_START_SLOT, width: BAG_WIDTH, height: BAG_HEIGHT });
}

module.exports = {
  ITEM_DB_BYTE,
  INVENTORY_SIZE,
  BAG_START_SLOT,
  BAG_END_SLOT,
  BAG_WIDTH,
  BAG_HEIGHT,
  isSlotEmpty: codec.isSlotEmpty,
  decodeItemType: codec.decodeItemType,
  getItemDimensions: codec.getItemDimensions,
  buildBagGrid,
};
