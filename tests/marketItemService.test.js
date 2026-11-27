const marketItems = require('../src/services/marketItemService');
const warehouseService = require('../src/services/warehouseService');
const catalog = require('../src/data/marketCatalog.json');
const { makeItemBytes, makeVault } = require('./helpers/marketItems');

describe('catálogo do mercado', () => {
  it('tem os 231 itens da fase 1 + 2 joias, todos com imagem e tamanho', () => {
    const entries = Object.values(catalog);
    expect(entries).toHaveLength(233);
    for (const e of entries) {
      expect(e.image).toEqual(expect.any(String));
      expect(e.width).toBeGreaterThan(0);
      expect(e.height).toBeGreaterThan(0);
      expect(marketItems.CATEGORY_IDS).toContain(e.category);
    }
  });

  it('só as asas de 1º nível entram, e sem exigir excelente', () => {
    const wings = Object.values(catalog).filter((e) => e.category === 'wing');
    expect(wings.map((w) => `${w.group}:${w.index}`).sort()).toEqual(['12:0', '12:1', '12:2']);
    expect(wings.every((w) => w.excellentRequired === false)).toBe(true);
  });

  it('joias: só Jewel of Excellent e Jewel of Reset, sem classe e sem exigir excelente', () => {
    const jewels = Object.values(catalog).filter((e) => e.category === 'jewel');
    expect(jewels.map((j) => `${j.group}:${j.index} ${j.name}`).sort()).toEqual([
      '14:84 Jewel of Excellent',
      '14:92 Jewel of Reset',
    ]);
    expect(jewels.every((j) => j.excellentRequired === false && j.classes.length === 0)).toBe(true);
  });
});

describe('decodeItem', () => {
  it('lê level, skill, luck, opção adicional, excelentes e serial', () => {
    const bytes = makeItemBytes({ group: 7, index: 1, level: 9, exc: 0x21, skill: false, luck: true, addOption: 5, serial: 123456 });
    const item = marketItems.decodeItem(bytes);
    expect(item).toEqual(
      expect.objectContaining({
        group: 7,
        index: 1,
        name: 'Dragon Helm',
        category: 'helm',
        level: 9,
        luck: true,
        skill: false,
        additionalOption: 5,
        additionalOptionText: 'Defesa adicional +20',
        excCount: 2,
        serial: 123456,
        ancient: false,
      }),
    );
    expect(item.excellent).toEqual(['Vida máxima +4%', 'Zen após matar monstro +40%']);
  });

  it('decodifica tipos acima de 255 (bit de extensão no byte 7)', () => {
    const item = marketItems.decodeItem(makeItemBytes({ group: 8, index: 37, exc: 1 }));
    expect(item.name).toBe('Valiant Armor');
  });

  it('slot vazio volta null', () => {
    expect(marketItems.decodeItem(Buffer.alloc(16, 0xff))).toBeNull();
  });
});

describe('ineligibilityReason', () => {
  const reason = (spec) => marketItems.ineligibilityReason(marketItems.decodeItem(makeItemBytes(spec)));

  it('item das boxes só se for excelente', () => {
    expect(reason({ group: 0, index: 0 })).toBe('NOT_EXCELLENT');
    expect(reason({ group: 0, index: 0, exc: 0x01 })).toBeNull();
  });

  it('asa de 1º nível entra sem excelente; asa de 2º nível não entra', () => {
    expect(reason({ group: 12, index: 1 })).toBeNull();
    expect(reason({ group: 12, index: 3 })).toBe('NOT_IN_CATALOG');
  });

  it('Jewel of Excellent e Jewel of Reset entram, sem excelentes nem opção adicional', () => {
    expect(reason({ group: 14, index: 84 })).toBeNull();
    expect(reason({ group: 14, index: 92 })).toBeNull();
    const jewel = marketItems.decodeItem(makeItemBytes({ group: 14, index: 92 }));
    expect(jewel).toEqual(expect.objectContaining({ name: 'Jewel of Reset', category: 'jewel', excellent: [], additionalOptionText: null }));
  });

  it('item fora do catálogo (Jewel of Bless) e ancient ficam de fora', () => {
    expect(reason({ group: 14, index: 13 })).toBe('NOT_IN_CATALOG');
    expect(reason({ group: 7, index: 1, exc: 1, ancient: true })).toBe('ANCIENT');
  });
});

describe('typesForClass', () => {
  it('devolve só itens usáveis pela classe', () => {
    const types = marketItems.typesForClass('dl');
    expect(types).toContain(12 * 512 + 2); // Wings of Satan (flag DL no Item.txt do servidor)
    expect(types).not.toContain(7 * 512 + 1); // Dragon Helm é só DK
  });
});

describe('warehouseService.findFreeArea', () => {
  it('acha o primeiro canto livre para um item 2x3', () => {
    // Kris (1x2) no slot 0 ocupa (0,0) e (0,1); um 2x3 começa na coluna 1.
    const vault = makeVault({ 0: makeItemBytes({ group: 0, index: 0, exc: 1 }) });
    expect(warehouseService.findFreeArea(vault, 2, 3)).toBe(1);
  });

  it('respeita o footprint de itens grandes e a borda do baú', () => {
    // Wings of Heaven (5x3) no slot 0 ocupa colunas 0-4 das linhas 0-2.
    const vault = makeVault({ 0: makeItemBytes({ group: 12, index: 1 }) });
    expect(warehouseService.findFreeArea(vault, 3, 3)).toBe(5);
    expect(warehouseService.findFreeArea(vault, 4, 1)).toBe(3 * 8); // não cabe 4 de largura ao lado: vai pra linha 3
  });

  it('devolve -1 quando não cabe', () => {
    const full = Buffer.alloc(1920, 0x00); // 120 itens 0:0 (Kris)
    expect(warehouseService.findFreeArea(full, 1, 1)).toBe(-1);
  });
});
