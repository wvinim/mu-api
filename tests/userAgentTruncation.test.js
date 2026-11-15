// Regressão: o navegador interno do Instagram manda user-agent com ~340
// caracteres. Os parâmetros eram VarChar(255) sem corte, e o SQL Server
// rejeitava ("Data type 0xA7 has an invalid data length") — o insert do
// refresh token falhava e o login inteiro dava 500.

jest.mock('../src/db/pool', () => ({
  sql: new Proxy({}, { get: () => jest.fn(() => 'type') }),
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const auditLogRepository = require('../src/db/auditLogRepository');
const refreshTokensRepository = require('../src/db/refreshTokensRepository');

const LONG_UA = 'Mozilla/5.0 (Linux; Android 14; moto g04 Build/ULAS34.89-208-4; wv) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Version/4.0 Chrome/157.0.8103.44 Mobile Safari/537.36 Instagram 455.0.0.51.72 '
  + 'Android (34/14; 280dpi; 720x1612; motorola; moto g04; lion; lion; pt_BR; 1110835071; IABMV/1)';

function mockPool() {
  const inputs = {};
  const request = {
    input: (name, _type, value) => { inputs[name] = value; return request; },
    query: jest.fn().mockResolvedValue({ recordset: [] }),
  };
  getPool.mockReturnValue({ request: () => request });
  return inputs;
}

describe('truncamento do user-agent', () => {
  it('sanity: o UA de exemplo passa de 255', () => {
    expect(LONG_UA.length).toBeGreaterThan(255);
  });

  it('refreshTokensRepository.create corta em 255', async () => {
    const inputs = mockPool();
    await refreshTokensRepository.create({
      accountId: 'player1', tokenHash: 'a'.repeat(64), expiresAt: new Date(), userAgent: LONG_UA,
    });
    expect(inputs.userAgent).toHaveLength(255);
  });

  it('auditLogRepository.record corta em 255', async () => {
    const inputs = mockPool();
    await auditLogRepository.record({ eventType: 'auth.login.success', userAgent: LONG_UA });
    expect(inputs.userAgent).toHaveLength(255);
  });

  it('mantém null quando não há user-agent', async () => {
    const inputs = mockPool();
    await refreshTokensRepository.create({ accountId: 'p', tokenHash: 'a'.repeat(64), expiresAt: new Date() });
    expect(inputs.userAgent).toBeNull();
  });
});
