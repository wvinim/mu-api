const { fromGameDbLocal } = require('../src/utils/gameDbTime');

describe('fromGameDbLocal', () => {
  it('reinterpreta o datetime do jogo (lido como UTC pelo driver) como horário de Brasília', () => {
    // GETDATE() gravou 17:37 no servidor; o driver entrega 17:37Z
    const fromDriver = new Date('2026-10-05T17:37:00.000Z');
    const iso = fromGameDbLocal(fromDriver);
    expect(iso).toBe('2026-10-05T17:37:00-03:00');
    expect(new Date(iso).toISOString()).toBe('2026-10-05T20:37:00.000Z');
  });

  it('valor ausente vira null', () => {
    expect(fromGameDbLocal(null)).toBeNull();
  });
});
