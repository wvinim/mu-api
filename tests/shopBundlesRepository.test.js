// Regressão: GET /admin/shop/bundles quebrava contra o SQL Server real com
// "A column has been specified more than once in the order by list" — o
// JOIN de WebShopBundles + WebShopBundleItems + WebShopItems tem uma
// coluna Id em CADA uma das três tabelas, e o ORDER BY ordenava por
// `bi.Id` (não presente no SELECT) junto com `b.Id`. Os testes de
// controller (admin.test.js/shop.test.js) mockam esse repositório
// inteiro, então nunca executam o SQL de verdade — por isso esse bug só
// apareceu contra o banco real. Este teste inspeciona o texto da query
// pra travar a regra: ORDER BY só pode referenciar os aliases do próprio
// SELECT (sempre únicos), nunca `tabela.Id` qualificado.

jest.mock('../src/db/pool', () => ({
  sql: new Proxy({}, { get: () => jest.fn(() => 'type') }),
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const shopBundlesRepository = require('../src/db/shopBundlesRepository');

function mockPoolQuery(recordset) {
  const query = jest.fn().mockResolvedValue({ recordset });
  const request = { query, input: () => request };
  getPool.mockReturnValue({ request: () => request });
  return query;
}

function assertOrderByHasNoQualifiedId(sqlText) {
  const orderByClause = sqlText.match(/ORDER BY\s+(.+?)(?:\s*$|\n)/is)[1];
  expect(orderByClause).not.toMatch(/\bb\.Id\b/);
  expect(orderByClause).not.toMatch(/\bbi\.Id\b/);
  expect(orderByClause).not.toMatch(/\bi\.Id\b/);
}

describe('shopBundlesRepository — ORDER BY sem ambiguidade de coluna', () => {
  it('findActiveWithItems ordena só por aliases do SELECT', async () => {
    const query = mockPoolQuery([]);
    await shopBundlesRepository.findActiveWithItems();
    assertOrderByHasNoQualifiedId(query.mock.calls[0][0]);
  });

  it('findById ordena só por aliases do SELECT', async () => {
    const query = mockPoolQuery([]);
    await shopBundlesRepository.findById(5);
    assertOrderByHasNoQualifiedId(query.mock.calls[0][0]);
  });

  it('findAllAdmin ordena só por aliases do SELECT', async () => {
    const query = mockPoolQuery([]);
    await shopBundlesRepository.findAllAdmin();
    assertOrderByHasNoQualifiedId(query.mock.calls[0][0]);
  });

  it('findAllAdmin agrupa itens do mesmo bundle numa única entrada', async () => {
    mockPoolQuery([
      { id: 5, name: 'Pacote PK', description: null, priceCredits: 900, active: true, createdAt: new Date(), componentId: 1, shopItemId: 2, itemName: 'Jewel Pack', quantity: 10 },
      { id: 5, name: 'Pacote PK', description: null, priceCredits: 900, active: true, createdAt: new Date(), componentId: 2, shopItemId: 3, itemName: 'Kundun Box', quantity: 10 },
    ]);

    const bundles = await shopBundlesRepository.findAllAdmin();

    expect(bundles).toHaveLength(1);
    expect(bundles[0].items).toEqual([
      { shopItemId: 2, itemName: 'Jewel Pack', quantity: 10 },
      { shopItemId: 3, itemName: 'Kundun Box', quantity: 10 },
    ]);
  });
});
