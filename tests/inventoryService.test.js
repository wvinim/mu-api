const inventoryService = require('../src/services/inventoryService');
const { makeSimpleItemSlot } = require('../src/services/itemSlotCodec');

const { ITEM_DB_BYTE, INVENTORY_SIZE, BAG_START_SLOT } = inventoryService;

function emptyInventory() {
  return Buffer.alloc(ITEM_DB_BYTE * INVENTORY_SIZE, 0xff);
}

function placeItem(buffer, slot, itemSpec) {
  makeSimpleItemSlot(itemSpec).copy(buffer, slot * ITEM_DB_BYTE);
}

// Escrita da loja migrou pro baú da conta (warehouseService.test.js) — este
// arquivo cobre só o que inventoryService ainda faz: leitura de
// Character.Inventory (scripts/dumpInventorySlots.js e futura rota
// GET /characters/:name/inventory).

describe('decodeItemType', () => {
  it('reconstrói o mesmo type usado para montar o slot (round-trip)', () => {
    const cases = [
      { itemGroup: 0, itemIndex: 0 }, // Kris
      { itemGroup: 8, itemIndex: 26 }, // Adamantine Armor (2x2)
      { itemGroup: 14, itemIndex: 13 }, // Jewel of Bless (1x1)
      { itemGroup: 15, itemIndex: 18 }, // Scroll of Nova (fim da tabela real)
    ];

    for (const { itemGroup, itemIndex } of cases) {
      const slot = makeSimpleItemSlot({ itemGroup, itemIndex });
      const type = inventoryService.decodeItemType(slot);
      expect(Math.floor(type / 512)).toBe(itemGroup);
      expect(type % 512).toBe(itemIndex);
    }
  });
});

describe('getItemDimensions', () => {
  it('retorna as dimensões reais vindas de docs/inv/Item.txt (src/data/itemDimensions.json)', () => {
    expect(inventoryService.getItemDimensions(8, 26)).toEqual({ width: 2, height: 2, name: 'Adamantine Armor' });
    expect(inventoryService.getItemDimensions(14, 13)).toEqual({ width: 1, height: 1, name: 'Jewel of Bless' });
    expect(inventoryService.getItemDimensions(99, 99)).toBeNull();
  });
});

describe('buildBagGrid — bug real de produção (item 2x2 escondendo células)', () => {
  it('marca as 4 células cobertas por um item 2x2, não só o slot âncora', () => {
    const buffer = emptyInventory();
    // Adamantine Armor (grupo 8, índice 26 — 2x2) âncora no primeiro slot da mochila.
    placeItem(buffer, BAG_START_SLOT, { itemGroup: 8, itemIndex: 26 });

    const { occupied, unknownItems } = inventoryService.buildBagGrid(buffer);
    expect(unknownItems).toHaveLength(0);
    // Linha 0: colunas 0 e 1 cobertas. Linha 1: colunas 0 e 1 também (footprint 2x2).
    expect(occupied[0]).toBe(true); // (row0,col0) — âncora
    expect(occupied[1]).toBe(true); // (row0,col1) — coberta, mas 0xFF no array
    expect(occupied[8]).toBe(true); // (row1,col0) — coberta
    expect(occupied[9]).toBe(true); // (row1,col1) — coberta
    // Vizinho fora do footprint continua livre.
    expect(occupied[2]).toBe(false); // (row0,col2)
    expect(occupied[16]).toBe(false); // (row2,col0)
  });

  it('sem itens maiores que 1x1, o comportamento antigo (1 slot = 1 célula) é preservado', () => {
    const buffer = emptyInventory();
    placeItem(buffer, BAG_START_SLOT, { itemGroup: 14, itemIndex: 13 }); // Jewel of Bless, 1x1

    const { occupied } = inventoryService.buildBagGrid(buffer);
    expect(occupied.filter((cell) => !cell)).toHaveLength(63);
    expect(occupied[0]).toBe(true);
    expect(occupied[1]).toBe(false);
  });

  it('reporta o item fora da tabela de dimensões em unknownItems, em vez de arriscar sobrescrever', () => {
    const buffer = emptyInventory();
    // grupo/índice dentro da faixa codificável pelo formato de type, mas fora de Item.txt.
    placeItem(buffer, BAG_START_SLOT, { itemGroup: 3, itemIndex: 99 });

    const { unknownItems } = inventoryService.buildBagGrid(buffer);
    expect(unknownItems).toEqual([{ slot: BAG_START_SLOT, itemGroup: 3, itemIndex: 99 }]);
  });
});
