// Testes de texto de SQL do accountsRepository.createAccount — os testes de
// controller (auth.test.js) mockam o repositório inteiro, então a garantia
// de e-mail único (applock + checagem + INSERT na mesma transação) só seria
// exercitada contra o banco real sem isso.

jest.mock('../src/db/pool', () => ({
  sql: { VarChar: jest.fn(() => 'type'), NVarChar: jest.fn(() => 'type'), Int: 'int' },
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const accountsRepository = require('../src/db/accountsRepository');

function mockPool(created) {
  const inputs = {};
  const query = jest.fn().mockResolvedValue({ recordset: [{ created }] });
  const req = {
    input: jest.fn((name, type, value) => {
      inputs[name] = value;
      return req;
    }),
    query,
  };
  getPool.mockReturnValue({ request: () => req });
  return { inputs, query };
}

const args = { username: 'novo123', plainPassword: 'senha123', email: 'Novo@Example.com', passwordHash: 'hash' };

describe('accountsRepository.createAccount', () => {
  test('checa o e-mail e insere na mesma transação, sob applock por e-mail', async () => {
    const { inputs, query } = mockPool(true);
    await expect(accountsRepository.createAccount(args)).resolves.toEqual({ created: true });

    const text = query.mock.calls[0][0];
    expect(text).toMatch(/SET XACT_ABORT ON/);
    expect(text).toMatch(/BEGIN TRANSACTION/);
    expect(text).toMatch(/sp_getapplock[\s\S]*@LockOwner = 'Transaction'/);
    // A ordem importa: lock → checagem → INSERT.
    const lockAt = text.indexOf('sp_getapplock');
    const checkAt = text.indexOf('IF EXISTS (SELECT 1 FROM MEMB_INFO WHERE mail_addr = @email)');
    const insertAt = text.indexOf('INSERT INTO MEMB_INFO');
    expect(lockAt).toBeGreaterThan(-1);
    expect(checkAt).toBeGreaterThan(lockAt);
    expect(insertAt).toBeGreaterThan(checkAt);

    // Lock normalizado em minúsculas: "A@x" e "a@x" disputam o mesmo lock.
    expect(inputs.lockResource).toBe('mu-api:register-email:novo@example.com');
    // O e-mail gravado continua como o usuário digitou.
    expect(inputs.email).toBe('Novo@Example.com');
  });

  test('retorna created=false quando o e-mail já existe', async () => {
    mockPool(false);
    await expect(accountsRepository.createAccount(args)).resolves.toEqual({ created: false });
  });
});

describe('accountsRepository.setEmailConfirmed', () => {
  function mockUpdate(recordset) {
    const inputs = {};
    const query = jest.fn().mockResolvedValue({ recordset });
    const req = {
      input: jest.fn((name, type, value) => {
        inputs[name] = value;
        return req;
      }),
      query,
    };
    getPool.mockReturnValue({ request: () => req });
    return { inputs, query };
  }

  test('sem bônus só confirma, e só se ainda estava pendente', async () => {
    const { inputs, query } = mockUpdate([{ cash: 0, vip: 0, vipEndDate: null }]);
    await expect(accountsRepository.setEmailConfirmed('player1')).resolves.toMatchObject({ confirmed: true });

    const text = query.mock.calls[0][0];
    expect(text).toMatch(/SET mail_chek = '1', modi_days = GETDATE\(\)\s/);
    expect(text).toMatch(/WHERE memb___id = @username AND \(mail_chek IS NULL OR mail_chek <> '1'\)/);
    expect(text).not.toMatch(/Cash =|Vip =/);
    expect(inputs).toEqual({ username: 'player1' });
  });

  test('com bônus credita Cash e grava o VIP no mesmo UPDATE', async () => {
    const { inputs, query } = mockUpdate([{ cash: 500, vip: 3, vipEndDate: new Date() }]);
    await accountsRepository.setEmailConfirmed('player1', { cash: 500, vipTier: 3, vipDays: 30 });

    const text = query.mock.calls[0][0];
    expect(text).toMatch(/Cash = ISNULL\(Cash, 0\) \+ @bonusCash/);
    expect(text).toMatch(/Vip = @bonusVipTier, VipStartDate = GETDATE\(\), VipEndDate = DATEADD\(day, @bonusVipDays, GETDATE\(\)\)/);
    expect(text).toMatch(/mail_chek <> '1'/);
    expect(inputs).toMatchObject({ bonusCash: 500, bonusVipTier: 3, bonusVipDays: 30 });
  });

  test('conta já confirmada: nenhuma linha atualizada', async () => {
    mockUpdate([]);
    await expect(accountsRepository.setEmailConfirmed('player1', { cash: 500, vipTier: 3, vipDays: 30 })).resolves.toEqual({
      confirmed: false,
    });
  });
});
