const inventoryService = require('../src/services/inventoryService');
const AppError = require('../src/utils/AppError');

const { ITEM_DB_BYTE, INVENTORY_SIZE, BAG_START_SLOT, makeSimpleItemSlot } = inventoryService;

function emptyInventory() {
  return Buffer.alloc(ITEM_DB_BYTE * INVENTORY_SIZE, 0xff);
}

function placeItem(buffer, slot, itemSpec) {
  makeSimpleItemSlot(itemSpec).copy(buffer, slot * ITEM_DB_BYTE);
}

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

describe('assertRedeemableAsSimpleItem', () => {
  it('aceita item 1x1 (jóia)', () => {
    expect(() => inventoryService.assertRedeemableAsSimpleItem(14, 13)).not.toThrow();
  });

  it('rejeita item que não é 1x1 (armadura 2x2) — inserção da loja não sabe reservar o footprint extra', () => {
    expect(() => inventoryService.assertRedeemableAsSimpleItem(8, 26)).toThrow(AppError);
  });

  it('rejeita item fora da tabela de dimensões', () => {
    expect(() => inventoryService.assertRedeemableAsSimpleItem(99, 99)).toThrow(AppError);
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

  it('reproduz o bug relatado: findEmptyBagSlot nunca escolhe uma célula coberta por item maior', () => {
    const buffer = emptyInventory();
    // Enche a linha 0 inteira (8 colunas) com 4 armaduras 2x2 lado a lado —
    // exatamente o padrão observado no personagem de teste real.
    for (let col = 0; col < 8; col += 2) {
      placeItem(buffer, BAG_START_SLOT + col, { itemGroup: 8, itemIndex: 26 });
    }
    // Linhas 0 e 1 devem estar 100% cobertas agora (8 armaduras-footprint = 16 células).
    expect(inventoryService.countEmptyBagSlots(buffer)).toBe(64 - 16);

    const freeSlot = inventoryService.findEmptyBagSlot(buffer);
    // O primeiro slot livre de verdade é o início da linha 2 (BAG_START_SLOT + 16),
    // nunca um dos slots "vazios" (0xFF) que na verdade estão cobertos nas linhas 0-1.
    expect(freeSlot).toBe(BAG_START_SLOT + 16);
  });

  it('sem itens maiores que 1x1, o comportamento antigo (1 slot = 1 célula) é preservado', () => {
    const buffer = emptyInventory();
    placeItem(buffer, BAG_START_SLOT, { itemGroup: 14, itemIndex: 13 }); // Jewel of Bless, 1x1

    expect(inventoryService.countEmptyBagSlots(buffer)).toBe(63);
    expect(inventoryService.findEmptyBagSlot(buffer)).toBe(BAG_START_SLOT + 1);
  });

  it('lança INVENTORY_UNKNOWN_ITEM se algum item da mochila não está na tabela de dimensões, em vez de arriscar sobrescrever', () => {
    const buffer = emptyInventory();
    placeItem(buffer, BAG_START_SLOT, { itemGroup: 99, itemIndex: 99 }); // não existe em Item.txt

    expect(() => inventoryService.findEmptyBagSlot(buffer)).toThrow(AppError);
    expect(() => inventoryService.countEmptyBagSlots(buffer)).toThrow(AppError);
    try {
      inventoryService.findEmptyBagSlot(buffer);
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err.code).toBe('INVENTORY_UNKNOWN_ITEM');
    }
  });
});
