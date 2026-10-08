// Texto de SQL do pixChargesRepository — os testes de controller mockam o
// repositório inteiro, então a atomicidade (marcar pago + creditar Cash ou
// liberar a chave de presente na mesma transação) só seria exercitada contra
// o banco real sem isso.

jest.mock('../src/db/pool', () => ({
  sql: { VarChar: jest.fn(() => 'type'), Int: 'int' },
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const pixChargesRepository = require('../src/db/pixChargesRepository');

function mockPool(row) {
  const query = jest.fn().mockResolvedValue({ recordset: [row] });
  const req = { input: jest.fn(() => req), query };
  getPool.mockReturnValue({ request: () => req });
  return { query, req };
}

describe('pixChargesRepository.markPaidAndCredit', () => {
  test('marca paga e credita Cash na mesma transação, só se ainda pending', async () => {
    const { query } = mockPool({ accountId: 'player1', creditsAmount: 1000, isGift: false });
    await expect(pixChargesRepository.markPaidAndCredit('abc')).resolves.toEqual({
      credited: true,
      accountId: 'player1',
      creditsAmount: 1000,
      isGift: false,
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

  test('presente: libera a chave (awaiting_payment -> available) em vez de creditar, na mesma transação', async () => {
    const { query } = mockPool({ accountId: 'player1', creditsAmount: 1000, isGift: true });
    await expect(pixChargesRepository.markPaidAndCredit('abc')).resolves.toEqual({
      credited: true,
      accountId: 'player1',
      creditsAmount: 1000,
      isGift: true,
    });

    const text = query.mock.calls[0][0];
    const markAt = text.indexOf("WHERE TxId = @txid AND Status = 'pending'");
    const giftBranchAt = text.indexOf('IF @isGift = 1');
    const releaseAt = text.indexOf("WHERE PixChargeId = @chargeId AND Status = 'awaiting_payment'");
    const elseAt = text.indexOf('ELSE', releaseAt);
    const creditAt = text.indexOf('SET Cash = Cash + @creditsAmount');
    expect(giftBranchAt).toBeGreaterThan(markAt);
    expect(releaseAt).toBeGreaterThan(giftBranchAt);
    // O crédito de Cash fica no ELSE — presente nunca credita o comprador.
    expect(elseAt).toBeGreaterThan(releaseAt);
    expect(creditAt).toBeGreaterThan(elseAt);
    expect(text).toMatch(/Status = 'available'/);
  });

  test('já processada → credited=false', async () => {
    mockPool({ accountId: null, creditsAmount: null, isGift: null });
    await expect(pixChargesRepository.markPaidAndCredit('abc')).resolves.toEqual({ credited: false });
  });
});

describe('pixChargesRepository.create', () => {
  test('cria cobrança e chave de presente na mesma transação', async () => {
    const { query, req } = mockPool(undefined);
    await pixChargesRepository.create({
      accountId: 'player1',
      packageId: 1,
      txid: 'abc',
      amountCents: 1000,
      creditsAmount: 1000,
      giftCode: 'MUPRO-AAAA-BBBB-CCCC-DDDD',
    });

    const text = query.mock.calls[0][0];
    const beginAt = text.indexOf('BEGIN TRANSACTION');
    const chargeAt = text.indexOf('INSERT INTO WebPixCharges');
    const giftAt = text.indexOf('INSERT INTO WebGiftCodes');
    const commitAt = text.indexOf('COMMIT TRANSACTION');
    expect(beginAt).toBeGreaterThan(-1);
    expect(chargeAt).toBeGreaterThan(beginAt);
    expect(giftAt).toBeGreaterThan(chargeAt);
    expect(commitAt).toBeGreaterThan(giftAt);
    expect(text).toMatch(/'awaiting_payment'/);
    expect(text).toMatch(/SCOPE_IDENTITY\(\)/);
    expect(req.input).toHaveBeenCalledWith('giftCode', 'type', 'MUPRO-AAAA-BBBB-CCCC-DDDD');
  });

  test('compra para si: giftCode null (IsGift = 0, sem chave)', async () => {
    const { req } = mockPool(undefined);
    await pixChargesRepository.create({ accountId: 'player1', packageId: 1, txid: 'abc', amountCents: 1000, creditsAmount: 1000 });
    expect(req.input).toHaveBeenCalledWith('giftCode', 'type', null);
  });
});
