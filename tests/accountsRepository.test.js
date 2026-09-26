// Testes de texto de SQL do accountsRepository.createAccount — os testes de
// controller (auth.test.js) mockam o repositório inteiro, então a garantia
// de e-mail único (applock + checagem + INSERT na mesma transação) só seria
// exercitada contra o banco real sem isso.

jest.mock('../src/db/pool', () => ({
  sql: { VarChar: jest.fn(() => 'type'), NVarChar: jest.fn(() => 'type') },
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
