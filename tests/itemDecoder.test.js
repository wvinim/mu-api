const { decodeItem, decodeContainer } = require('../src/services/itemDecoder');
const codec = require('../src/services/itemSlotCodec');

function slot({ group, index, level = 0, skill = false, luck = false, additional = 0, excellent = 0, setOption = 0, harmony = 0, serial = 0, dur = 255 }) {
  const bytes = codec.makeSimpleItemSlot({ itemGroup: group, itemIndex: index, itemLevel: 0, quantity: dur });
  bytes[1] = ((level & 0x0f) << 3) | (skill ? 0x80 : 0) | (luck ? 0x04 : 0) | (additional & 0x03);
  bytes[7] |= (excellent & 0x3f) | ((additional & 0x04) << 4);
  bytes[8] = setOption;
  bytes[10] = harmony;
  bytes.writeUInt32BE(serial, 3);
  return bytes;
}

describe('itemDecoder', () => {
  it('slot vazio volta null', () => {
    expect(decodeItem(Buffer.alloc(16, 0xff))).toBeNull();
  });

  it('decodifica o Horn of Uniria do dump real do baú (docs/WAREHOUSE_BYTE_FORMAT.md)', () => {
    const item = decodeItem(Buffer.from('0200ff000000000000d0000000000000', 'hex'));
    expect(item).toMatchObject({ group: 13, index: 2, known: true, level: 0, excellent: [], serial: 0 });
  });

  it('arma: level, skill, luck, opção adicional de 3 bits, excelentes de ataque e serial', () => {
    const item = decodeItem(slot({ group: 0, index: 3, level: 9, skill: true, luck: true, additional: 5, excellent: 0x20 | 0x04, serial: 0x01020304 }));
    expect(item.name).toBe('Katana');
    expect(item.category).toBe('espada');
    expect(item.level).toBe(9);
    expect(item.skill).toBe(true);
    expect(item.luck).toBe(true);
    expect(item.additionalOption).toBe(5); // bit 2 vem do byte 7 (0x40)
    expect(item.additionalOptionText).toBe('Dano adicional +20');
    expect(item.excellent).toEqual(['Taxa de dano excelente +10%', 'Velocidade de ataque +7']);
    expect(item.serial).toBe(0x01020304);
    expect(item.classes).toMatchObject({ dk: 1, dw: 0 });
  });

  it('armadura usa a tabela de excelentes de defesa', () => {
    const item = decodeItem(slot({ group: 8, index: 1, excellent: 0x20 | 0x01 }));
    expect(item.category).toBe('armadura');
    expect(item.excellent).toEqual(['Vida máxima +4%', 'Zen após matar monstro +40%']);
  });

  it('ancient: nome do set pelo link A/B e bônus de stamina', () => {
    // Rapier (0:2) tem link A = 21 no ItemSetType.txt
    const item = decodeItem(slot({ group: 0, index: 2, setOption: 0x01 | (0x02 << 2) }));
    expect(item.ancient).toEqual({ setName: 'Ceto', staminaBonus: 10 });
  });

  it('Harmony: opção e valor pelo level (tabela de armas)', () => {
    const item = decodeItem(slot({ group: 0, index: 3, harmony: (1 << 4) | 3 }));
    expect(item.harmony).toEqual({ name: 'Increase Minimum Attack Power', level: 3, value: 5 });
  });

  it('item fora do catálogo não lança — volta com known: false', () => {
    const item = decodeItem(slot({ group: 15, index: 500 }));
    expect(item.known).toBe(false);
    expect(item.name).toBe('Item 15:500');
  });

  it('decodeContainer devolve só os slots ocupados com posição na grade 8x15', () => {
    const buffer = Buffer.alloc(16 * 120, 0xff);
    slot({ group: 14, index: 13 }).copy(buffer, 0);
    slot({ group: 0, index: 3 }).copy(buffer, 119 * 16);
    const items = decodeContainer(buffer);
    expect(items.map((i) => [i.slot, i.x, i.y, i.name])).toEqual([
      [0, 0, 0, 'Jewel of Bless'],
      [119, 7, 14, 'Katana'],
    ]);
  });
});
