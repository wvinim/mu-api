// Texto de SQL do markPaidAndCredit — os testes de controller mockam o
// repositório inteiro, então a atomicidade (marcar pago + creditar Cash na
// mesma transação) só seria exercitada contra o banco real sem isso.

jest.mock('../src/db/pool', () => ({
  sql: { VarChar: jest.fn(() => 'type') },
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const pixChargesRepository = require('../src/db/pixChargesRepository');

function mockPool(row) {
  const query = jest.fn().mockResolvedValue({ recordset: [row] });
  const req = { input: jest.fn(() => req), query };
  getPool.mockReturnValue({ request: () => req });
  return query;
}

describe('pixChargesRepository.markPaidAndCredit', () => {
  test('marca paga e credita Cash na mesma transação, só se ainda pending', async () => {
    const query = mockPool({ accountId: 'player1', creditsAmount: 1000 });
    await expect(pixChargesRepository.markPaidAndCredit('abc')).resolves.toEqual({
      credited: true,
      accountId: 'player1',
      creditsAmount: 1000,
    });

    const text = query.mock.calls[0][0];
    expect(text).toMatch(/SET XACT_ABORT ON/);
    const beginAt = text.indexOf('BEGIN TRANSACTION');
    const markAt = text.indexOf("WHERE TxId = @txid AND Status = 'pending'");
    const creditAt = text.indexOf('SET Cash = Cash + @creditsAmount');
    const commitAt = text.indexOf('COMMIT TRANSACTION');
    expect(beginAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(beginAt);
    expect(creditAt).toBeGreaterThan(markAt);
    expect(commitAt).toBeGreaterThan(creditAt);
    // Conta inexistente aborta (rollback) em vez de deixar "paga sem crédito".
    // (ROLLBACK explícito: RAISERROR não aborta a transação sozinho.)
    expect(text).toMatch(/IF @@ROWCOUNT <> 1\s*BEGIN[\s\S]*ROLLBACK TRANSACTION;\s*RAISERROR\([\s\S]*RETURN;/);
    // Sem JOIN com MEMB_INFO (conflito de collation — docs/DB_NOTES.md).
    expect(text).not.toMatch(/JOIN/i);
  });

  test('já processada → credited=false', async () => {
    mockPool({ accountId: null, creditsAmount: null });
    await expect(pixChargesRepository.markPaidAndCredit('abc')).resolves.toEqual({ credited: false });
  });
});
