const warehouseService = require('../src/services/warehouseService');
const { makeSimpleItemSlot } = require('../src/services/itemSlotCodec');
const AppError = require('../src/utils/AppError');

const { ITEM_DB_BYTE, WAREHOUSE_SIZE, WAREHOUSE_WIDTH } = warehouseService;

function placeItem(buffer, slot, itemSpec) {
  makeSimpleItemSlot(itemSpec).copy(buffer, slot * ITEM_DB_BYTE);
}

describe('warehouseService — grade 8x15 (120 slots), sem faixa de equipamento a excluir', () => {
  it('emptyItemsBuffer tem o tamanho exato da coluna (1920 bytes) e é reconhecido como totalmente livre', () => {
    const buffer = warehouseService.emptyItemsBuffer();
    expect(buffer.length).toBe(1920);
    expect(warehouseService.countEmptyWarehouseSlots(buffer)).toBe(WAREHOUSE_SIZE);
  });

  it('insere no slot 0 (primeira posição), não pula slots como a mochila do personagem (sem equipamento a evitar)', () => {
    const buffer = warehouseService.emptyItemsBuffer();
    const { slot } = warehouseService.insertItemIntoWarehouse(buffer, { itemGroup: 14, itemIndex: 13 });
    expect(slot).toBe(0);
  });

  it('preenchendo os 120 slots, o próximo insert retorna WAREHOUSE_FULL', () => {
    let buffer = warehouseService.emptyItemsBuffer();
    for (let i = 0; i < WAREHOUSE_SIZE; i++) {
      buffer = warehouseService.insertItemIntoWarehouse(buffer, { itemGroup: 14, itemIndex: 13 }).buffer;
    }
    expect(warehouseService.findEmptyWarehouseSlot(buffer)).toBe(-1);
    expect(() => warehouseService.insertItemIntoWarehouse(buffer, { itemGroup: 14, itemIndex: 13 })).toThrow(AppError);
    try {
      warehouseService.insertItemIntoWarehouse(buffer, { itemGroup: 14, itemIndex: 13 });
    } catch (err) {
      expect(err.code).toBe('WAREHOUSE_FULL');
    }
  });

  it('mesmo bug de footprint 2x2 do Character.Inventory (docs/INVENTORY_BYTE_FORMAT.md) também é tratado aqui, na grade maior', () => {
    const buffer = warehouseService.emptyItemsBuffer();
    // Adamantine Armor (2x2) âncora no slot 0 — cobre (0,0),(0,1),(1,0),(1,1) = slots 0,1,8,9 na grade 8-larga.
    placeItem(buffer, 0, { itemGroup: 8, itemIndex: 26 });

    const { occupied } = warehouseService.buildWarehouseGrid(buffer);
    expect(occupied[0]).toBe(true);
    expect(occupied[1]).toBe(true);
    expect(occupied[WAREHOUSE_WIDTH]).toBe(true); // (row1,col0)
    expect(occupied[WAREHOUSE_WIDTH + 1]).toBe(true); // (row1,col1)
    expect(occupied[2]).toBe(false); // vizinho fora do footprint

    // Próximo item não pode cair em cima das células cobertas (0xFF mas ocupadas).
    const { slot } = warehouseService.insertItemIntoWarehouse(buffer, { itemGroup: 14, itemIndex: 13 });
    expect(slot).not.toBe(1);
    expect(slot).not.toBe(WAREHOUSE_WIDTH);
    expect(slot).not.toBe(WAREHOUSE_WIDTH + 1);
  });

  it('insertItemsIntoWarehouse é tudo ou nada — sem espaço para todos os itens, não grava nenhum', () => {
    let buffer = warehouseService.emptyItemsBuffer();
    // Deixa só 2 slots livres.
    for (let i = 0; i < WAREHOUSE_SIZE - 2; i++) {
      buffer = warehouseService.insertItemIntoWarehouse(buffer, { itemGroup: 14, itemIndex: 13 }).buffer;
    }

    expect(() =>
      warehouseService.insertItemsIntoWarehouse(buffer, [
        { itemGroup: 14, itemIndex: 13 },
        { itemGroup: 14, itemIndex: 13 },
        { itemGroup: 14, itemIndex: 13 },
      ]),
    ).toThrow(AppError);
  });
});
