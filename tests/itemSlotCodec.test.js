const codec = require('../src/services/itemSlotCodec');
const AppError = require('../src/utils/AppError');

describe('isSlotEmpty', () => {
  it('reconhece 16 bytes de 0xFF como vazio (mesma representação usada em Character.Inventory e warehouse.Items)', () => {
    expect(codec.isSlotEmpty(Buffer.alloc(16, 0xff))).toBe(true);
  });

  it('um slot recém-montado por makeSimpleItemSlot nunca é considerado vazio', () => {
    const slot = codec.makeSimpleItemSlot({ itemGroup: 14, itemIndex: 13 });
    expect(codec.isSlotEmpty(slot)).toBe(false);
  });
});

describe('assertRedeemableAsSimpleItem', () => {
  it('aceita item 1x1 (jóia)', () => {
    expect(() => codec.assertRedeemableAsSimpleItem(14, 13)).not.toThrow();
  });

  it('rejeita item que não é 1x1 (armadura 2x2) — inserção da loja não sabe reservar o footprint extra', () => {
    expect(() => codec.assertRedeemableAsSimpleItem(8, 26)).toThrow(AppError);
  });

  it('rejeita item fora da tabela de dimensões', () => {
    expect(() => codec.assertRedeemableAsSimpleItem(99, 99)).toThrow(AppError);
  });
});

describe('buildOccupancyGrid — genérico, parametrizado por startSlot/width/height', () => {
  it('funciona igual pra uma faixa pequena (mochila) e uma grande (baú), mesma lógica de footprint', () => {
    const buffer = Buffer.alloc(16 * 20, 0xff);
    codec.makeSimpleItemSlot({ itemGroup: 8, itemIndex: 26 }).copy(buffer, 0); // 2x2, âncora no slot 0

    const { occupied, unknownItems } = codec.buildOccupancyGrid(buffer, { startSlot: 0, width: 5, height: 4 });
    expect(unknownItems).toHaveLength(0);
    expect(occupied[0]).toBe(true);
    expect(occupied[1]).toBe(true);
    expect(occupied[5]).toBe(true);
    expect(occupied[6]).toBe(true);
    expect(occupied[2]).toBe(false);
  });
});
