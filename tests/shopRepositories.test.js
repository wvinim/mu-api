// Regressão: findAllAdmin() de itens da loja e pacotes de crédito devem
// retornar linhas em camelCase (como o resto da API), não PascalCase cru
// das colunas do SQL Server — bug reportado pelo frontend em GET
// /admin/shop/items e /admin/shop/credit-packages.

jest.mock('../src/db/pool', () => ({
  sql: new Proxy({}, { get: () => jest.fn(() => 'type') }),
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const shopItemsRepository = require('../src/db/shopItemsRepository');
const creditPackagesRepository = require('../src/db/creditPackagesRepository');

function mockPoolQuery(recordset) {
  const query = jest.fn().mockResolvedValue({ recordset });
  getPool.mockReturnValue({ request: () => ({ query, input: () => ({ query }) }) });
  return query;
}

describe('shopItemsRepository.findAllAdmin', () => {
  it('retorna as linhas em camelCase', async () => {
    mockPoolQuery([
      { id: 1, name: 'Bundle', description: null, priceCredits: 500, itemGroup: 14, itemIndex: 13, itemLevel: 0, quantity: 1, active: true, createdAt: new Date() },
    ]);

    const items = await shopItemsRepository.findAllAdmin();

    expect(items[0]).toEqual(
      expect.objectContaining({ id: 1, name: 'Bundle', priceCredits: 500, itemGroup: 14, itemIndex: 13 }),
    );
    expect(items[0].Id).toBeUndefined();
    expect(items[0].PriceCredits).toBeUndefined();
  });

  it('faz o SELECT com alias explícito para camelCase', async () => {
    const query = mockPoolQuery([]);
    await shopItemsRepository.findAllAdmin();

    const sqlText = query.mock.calls[0][0];
    expect(sqlText).toMatch(/PriceCredits AS priceCredits/);
    expect(sqlText).toMatch(/Id AS id/);
  });
});

describe('creditPackagesRepository.findAllAdmin', () => {
  it('retorna as linhas em camelCase', async () => {
    mockPoolQuery([
      { id: 3, name: '1000 Créditos', priceCents: 1000, creditsAmount: 1000, active: true, createdAt: new Date() },
    ]);

    const items = await creditPackagesRepository.findAllAdmin();

    expect(items[0]).toEqual(
      expect.objectContaining({ id: 3, name: '1000 Créditos', priceCents: 1000, creditsAmount: 1000 }),
    );
    expect(items[0].PriceCents).toBeUndefined();
  });

  it('faz o SELECT com alias explícito para camelCase', async () => {
    const query = mockPoolQuery([]);
    await creditPackagesRepository.findAllAdmin();

    const sqlText = query.mock.calls[0][0];
    expect(sqlText).toMatch(/PriceCents AS priceCents/);
    expect(sqlText).toMatch(/Id AS id/);
  });
});
