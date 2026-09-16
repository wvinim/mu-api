// Regressão: WebAuditLog tem uma PK própria (Id BIGINT IDENTITY, ver
// migrations/0001_web_auth_tables.sql) que não estava sendo selecionada —
// o frontend relatou que /admin/logs não trazia nenhum id, obrigando a
// usar accountId+eventType+createdAt como chave.

jest.mock('../src/db/pool', () => ({
  sql: new Proxy({}, { get: () => jest.fn(() => 'type') }),
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const auditLogRepository = require('../src/db/auditLogRepository');

function mockPoolQuery(recordsets) {
  const query = jest.fn().mockResolvedValue({ recordsets });
  const request = { query, input: () => request };
  getPool.mockReturnValue({ request: () => request });
  return query;
}

describe('auditLogRepository.findAll', () => {
  it('inclui id nas linhas retornadas', async () => {
    mockPoolQuery([[{ id: 7, accountId: 'player1', eventType: 'auth.login.success' }], [{ total: 1 }]]);

    const { items } = await auditLogRepository.findAll({});

    expect(items[0]).toEqual(expect.objectContaining({ id: 7 }));
  });

  it('seleciona Id AS id no SQL', async () => {
    const query = mockPoolQuery([[], [{ total: 0 }]]);
    await auditLogRepository.findAll({});
    expect(query.mock.calls[0][0]).toMatch(/Id AS id/);
  });
});

describe('auditLogRepository.findByAccount', () => {
  it('inclui id nas linhas retornadas', async () => {
    mockPoolQuery([[{ id: 9, eventType: 'auth.login.success' }], [{ total: 1 }]]);

    const { items } = await auditLogRepository.findByAccount('player1', {});

    expect(items[0]).toEqual(expect.objectContaining({ id: 9 }));
  });
});
