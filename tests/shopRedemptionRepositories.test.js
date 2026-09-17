// Testes de texto de SQL — CharacterName foi removida de WebItemRedemptions/
// WebBundleRedemptions (migrations/0007_drop_redemption_character_name.sql,
// ainda não aplicada). O código PRECISA funcionar tanto antes quanto depois
// da migration rodar, então nenhuma query pode referenciar essa coluna —
// os testes de controller (shop.test.js) mockam esses repositórios
// inteiros e não pegariam uma referência morta à coluna.

jest.mock('../src/db/pool', () => ({
  sql: new Proxy({}, { get: () => jest.fn(() => 'type') }),
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const itemRedemptionsRepository = require('../src/db/itemRedemptionsRepository');
const bundleRedemptionsRepository = require('../src/db/bundleRedemptionsRepository');
const shopHistoryRepository = require('../src/db/shopHistoryRepository');

function mockPoolQuery(recordset) {
  const query = jest.fn().mockResolvedValue({ recordset });
  const request = { query, input: () => request };
  getPool.mockReturnValue({ request: () => request });
  return query;
}

describe('itemRedemptionsRepository.create', () => {
  it('não referencia CharacterName', async () => {
    const query = mockPoolQuery([]);
    await itemRedemptionsRepository.create({ accountId: 'player1', shopItemId: 2, priceCredits: 100, slot: 5 });
    const sqlText = query.mock.calls[0][0];
    expect(sqlText).not.toMatch(/CharacterName/);
    expect(sqlText).toMatch(/INSERT INTO WebItemRedemptions \(AccountId, ShopItemId, PriceCredits, Slot\)/);
  });
});

describe('bundleRedemptionsRepository.create', () => {
  it('não referencia CharacterName', async () => {
    const query = mockPoolQuery([]);
    await bundleRedemptionsRepository.create({ accountId: 'player1', bundleId: 5, priceCredits: 900 });
    const sqlText = query.mock.calls[0][0];
    expect(sqlText).not.toMatch(/CharacterName/);
    expect(sqlText).toMatch(/INSERT INTO WebBundleRedemptions \(AccountId, BundleId, PriceCredits\)/);
  });
});

describe('shopHistoryRepository.findByAccount', () => {
  it('não seleciona CharacterName em nenhuma das 4 pernas do UNION ALL', async () => {
    const query = jest.fn().mockResolvedValue({ recordsets: [[], [{ total: 0 }]] });
    const request = { query, input: () => request };
    getPool.mockReturnValue({ request: () => request });

    await shopHistoryRepository.findByAccount('player1');

    const sqlText = query.mock.calls[0][0];
    expect(sqlText).not.toMatch(/CharacterName/);
    expect(sqlText).not.toMatch(/characterName/);
  });
});
