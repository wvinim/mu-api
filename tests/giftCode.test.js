const giftCode = require('../src/utils/giftCode');

describe('utils/giftCode', () => {
  test('gera no formato canônico, sem caracteres ambíguos', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(giftCode.generate()).toMatch(/^MUPRO(-[2-9A-HJKMNP-Z]{4}){4}$/);
    }
  });

  test('chaves geradas não se repetem', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => giftCode.generate()));
    expect(codes.size).toBe(1000);
  });

  test('normaliza o que o usuário digitar', () => {
    const canonical = 'MUPRO-ABCD-EFGH-JKMN-PQRS';
    expect(giftCode.normalize(canonical)).toBe(canonical);
    expect(giftCode.normalize('mupro-abcd-efgh-jkmn-pqrs')).toBe(canonical);
    expect(giftCode.normalize('  ABCD EFGH JKMN PQRS ')).toBe(canonical);
    expect(giftCode.normalize('abcdefghjkmnpqrs')).toBe(canonical);
  });

  test('rejeita o que não parece chave', () => {
    expect(giftCode.normalize('')).toBeNull();
    expect(giftCode.normalize(null)).toBeNull();
    expect(giftCode.normalize('MUPRO-ABCD-EFGH-JKMN')).toBeNull();
    expect(giftCode.normalize('MUPRO-ABCD-EFGH-JKMN-PQR0')).toBeNull(); // 0 não existe no alfabeto
    expect(giftCode.normalize("x' OR 1=1 --")).toBeNull();
  });

  test('hint mostra só os 4 últimos caracteres', () => {
    expect(giftCode.hint('MUPRO-ABCD-EFGH-JKMN-PQRS')).toBe('PQRS');
  });
});
