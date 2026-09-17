// Testes de texto de SQL pros repositórios novos da feature VIP (ver
// docs/SECTION_9_VIP.md) — os testes de controller (shop.test.js,
// account.test.js, admin.test.js) mockam esses repositórios inteiros e
// nunca executam o SQL de verdade, então erros de nome de coluna/tabela
// só apareceriam contra o banco real sem isso (mesma lição de
// tests/shopBundlesRepository.test.js).

jest.mock('../src/db/pool', () => ({
  sql: new Proxy({}, { get: () => jest.fn(() => 'type') }),
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const vipPlansRepository = require('../src/db/vipPlansRepository');
const vipPurchasesRepository = require('../src/db/vipPurchasesRepository');
const autopickRepository = require('../src/db/autopickRepository');
const shopHistoryRepository = require('../src/db/shopHistoryRepository');
const accountsRepository = require('../src/db/accountsRepository');

function mockPoolQuery(recordset) {
  const query = jest.fn().mockResolvedValue({ recordset });
  const request = { query, input: () => request };
  getPool.mockReturnValue({ request: () => request });
  return query;
}

describe('vipPlansRepository', () => {
  it('findActive filtra por Active = 1 e ordena por Tier', async () => {
    const query = mockPoolQuery([]);
    await vipPlansRepository.findActive();
    const sqlText = query.mock.calls[0][0];
    expect(sqlText).toMatch(/WHERE Active = 1/);
    expect(sqlText).toMatch(/ORDER BY Tier/);
  });

  it('update só grava PriceCredits/Active quando informados, nunca Tier/Name/DurationDays', async () => {
    const query = mockPoolQuery([]);
    await vipPlansRepository.update(1, { priceCredits: 100, active: false });
    const sqlText = query.mock.calls[0][0];
    expect(sqlText).toMatch(/PriceCredits = @priceCredits/);
    expect(sqlText).toMatch(/Active = @active/);
    expect(sqlText).not.toMatch(/\bTier\s*=/);
    expect(sqlText).not.toMatch(/\bName\s*=/);
    expect(sqlText).not.toMatch(/DurationDays\s*=/);
  });

  it('update não faz nenhuma query se nenhum campo editável for informado', async () => {
    const query = mockPoolQuery([]);
    await vipPlansRepository.update(1, {});
    expect(query).not.toHaveBeenCalled();
  });
});

describe('vipPurchasesRepository.create', () => {
  it('insere em WebVipPurchases com as colunas certas', async () => {
    const query = mockPoolQuery([]);
    await vipPurchasesRepository.create({ accountId: 'player1', planId: 2, tier: 2, priceCredits: 120, durationDays: 30 });
    const sqlText = query.mock.calls[0][0];
    expect(sqlText).toMatch(/INSERT INTO WebVipPurchases/);
    expect(sqlText).toMatch(/AccountId, PlanId, Tier, PriceCredits, DurationDays/);
  });
});

describe('autopickRepository.findByAccount', () => {
  it('usa a coluna AccountID (I maiúsculo) da tabela MEMB_AUTOPICK_ITEMS, não AccountId', async () => {
    const query = mockPoolQuery([]);
    await autopickRepository.findByAccount('player1');
    const sqlText = query.mock.calls[0][0];
    expect(sqlText).toMatch(/FROM MEMB_AUTOPICK_ITEMS/);
    expect(sqlText).toMatch(/WHERE AccountID = @accountId/);
  });
});

describe('accountsRepository.renewVip — upgrade não soma dias, renovação/downgrade soma', () => {
  it('compara @tier > Vip (valor pré-UPDATE) pra decidir se reseta ou estende as datas', async () => {
    const query = mockPoolQuery([{ vip: 3, vipStartDate: new Date(), vipEndDate: new Date() }]);
    await accountsRepository.renewVip('player1', { tier: 3, days: 30 });
    const sqlText = query.mock.calls[0][0];

    // Upgrade (@tier > Vip antigo): reseta pra agora, sem somar ao VipEndDate antigo.
    expect(sqlText).toMatch(/WHEN VipEndDate IS NOT NULL AND VipEndDate > GETDATE\(\) AND @tier > Vip THEN GETDATE\(\)/);
    expect(sqlText).toMatch(/WHEN VipEndDate IS NOT NULL AND VipEndDate > GETDATE\(\) AND @tier > Vip THEN DATEADD\(day, @days, GETDATE\(\)\)/);

    // Renovação (mesma tier) ou downgrade: mantém o comportamento antigo de somar ao VipEndDate/VipStartDate existentes.
    expect(sqlText).toMatch(/WHEN VipEndDate IS NOT NULL AND VipEndDate > GETDATE\(\) THEN VipStartDate/);
    expect(sqlText).toMatch(/WHEN VipEndDate IS NOT NULL AND VipEndDate > GETDATE\(\) THEN DATEADD\(day, @days, VipEndDate\)/);
  });
});

describe('shopHistoryRepository — inclui compras de VIP no histórico unificado', () => {
  it('faz UNION ALL com WebVipPurchases/WebVipPlans', async () => {
    const query = jest.fn().mockResolvedValue({ recordsets: [[], [{ total: 0 }]] });
    const request = { query, input: () => request };
    getPool.mockReturnValue({ request: () => request });

    await shopHistoryRepository.findByAccount('player1');

    const sqlText = query.mock.calls[0][0];
    expect(sqlText).toMatch(/'vip_purchase' AS type/);
    expect(sqlText).toMatch(/FROM WebVipPurchases r/);
    expect(sqlText).toMatch(/JOIN WebVipPlans p ON p\.Id = r\.PlanId/);
  });
});
