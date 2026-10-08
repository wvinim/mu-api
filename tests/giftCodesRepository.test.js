// Texto de SQL do giftCodesRepository (os testes de controller mockam o
// repositório inteiro): resgate atômico, não vazar chave aguardando
// pagamento, sem JOIN com MEMB_INFO e sem COUNT(*).

jest.mock('../src/db/pool', () => ({
  sql: { VarChar: jest.fn(() => 'varchar'), Int: 'int', BigInt: 'bigint' },
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const giftCodesRepository = require('../src/db/giftCodesRepository');

function mockPool(result) {
  const query = jest.fn().mockResolvedValue(result);
  const req = { input: jest.fn(() => req), query };
  getPool.mockReturnValue({ request: () => req });
  return { query, req };
}

describe('giftCodesRepository.redeem', () => {
  test('marca resgatada e credita Cash na mesma transação, só se available', async () => {
    const { query } = mockPool({ recordset: [{ id: 7, creditsAmount: 500 }] });
    await expect(giftCodesRepository.redeem('MUPRO-AAAA-BBBB-CCCC-DDDD', 'player2')).resolves.toEqual({
      redeemed: true,
      id: 7,
      creditsAmount: 500,
    });

    const text = query.mock.calls[0][0];
    expect(text).toMatch(/SET XACT_ABORT ON/);
    const beginAt = text.indexOf('BEGIN TRANSACTION');
    const markAt = text.indexOf("WHERE Code = @code AND Status = 'available'");
    const creditAt = text.indexOf('SET Cash = Cash + @creditsAmount');
    const commitAt = text.indexOf('COMMIT TRANSACTION');
    expect(markAt).toBeGreaterThan(beginAt);
    expect(creditAt).toBeGreaterThan(markAt);
    expect(commitAt).toBeGreaterThan(creditAt);
    expect(text).toMatch(/IF @@ROWCOUNT <> 1\s*BEGIN[\s\S]*ROLLBACK TRANSACTION;\s*RAISERROR\([\s\S]*RETURN;/);
    expect(text).not.toMatch(/JOIN/i);
  });

  test('chave indisponível → redeemed=false', async () => {
    mockPool({ recordset: [{ id: null, creditsAmount: null }] });
    await expect(giftCodesRepository.redeem('MUPRO-AAAA-BBBB-CCCC-DDDD', 'player2')).resolves.toEqual({ redeemed: false });
  });
});

describe('giftCodesRepository.findByBuyer', () => {
  test('esconde a chave enquanto aguarda pagamento e some com cobrança expirada', async () => {
    const { query, req } = mockPool({ recordsets: [[], [{ total: 0 }]] });
    await giftCodesRepository.findByBuyer('player1', { page: 1, limit: 20, awaitingWindowSeconds: 3600 });

    const text = query.mock.calls[0][0];
    expect(text).toMatch(/CASE WHEN Status = 'awaiting_payment' THEN NULL ELSE Code END AS code/);
    expect(text).toMatch(/Status <> 'awaiting_payment' OR CreatedAt >= DATEADD\(second, -@awaitingWindowSeconds, SYSUTCDATETIME\(\)\)/);
    expect(text).not.toMatch(/COUNT\(\*\)/);
    expect(text).not.toMatch(/OFFSET|FETCH/);
    expect(req.input).toHaveBeenCalledWith('awaitingWindowSeconds', 'int', 3600);
  });
});

describe('giftCodesRepository.findAllAdmin', () => {
  test('qualifica todas as colunas no JOIN com WebPixCharges (ambas têm Id)', async () => {
    const { query } = mockPool({ recordsets: [[], [{ total: 0 }]] });
    await giftCodesRepository.findAllAdmin({ page: 1, limit: 20, accountId: 'player1', status: 'available' });

    const text = query.mock.calls[0][0];
    expect(text).toMatch(/JOIN WebPixCharges p ON p.Id = g.PixChargeId/);
    expect(text).toMatch(/ORDER BY g.CreatedAt DESC, g.Id DESC/);
    expect(text).toMatch(/g.BuyerAccountId = @accountId OR g.RedeemedByAccountId = @accountId/);
    expect(text).toMatch(/g.Status = @status/);
    expect(text).not.toMatch(/MEMB_INFO/);
  });
});

describe('giftCodesRepository.cancel', () => {
  test('só cancela chave available', async () => {
    const { query } = mockPool({
      recordset: [{ buyerAccountId: 'player1', creditsAmount: 500, code: 'MUPRO-AAAA-BBBB-CCCC-DDDD' }],
    });
    await expect(giftCodesRepository.cancel(7, 'admin')).resolves.toEqual(
      expect.objectContaining({ buyerAccountId: 'player1' }),
    );
    expect(query.mock.calls[0][0]).toMatch(/WHERE Id = @id AND Status = 'available'/);
  });
});
