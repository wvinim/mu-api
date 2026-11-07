// Texto de SQL do campaignsRepository (os testes de rota mockam o
// repositório inteiro): só grava para campanha cadastrada, dedup por
// navegador, corrida na UNIQUE tratada como duplicata.

jest.mock('../src/db/pool', () => ({
  sql: { VarChar: jest.fn(() => 'varchar'), Char: jest.fn(() => 'char'), NVarChar: jest.fn(() => 'nvarchar') },
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const campaignsRepository = require('../src/db/campaignsRepository');

function mockPool(resultOrError) {
  const query =
    resultOrError instanceof Error ? jest.fn().mockRejectedValue(resultOrError) : jest.fn().mockResolvedValue(resultOrError);
  const inputs = {};
  const req = {
    input: jest.fn((name, _type, value) => {
      inputs[name] = value;
      return req;
    }),
    query,
  };
  getPool.mockReturnValue({ request: () => req });
  return { query, inputs };
}

function uniqueViolation() {
  const err = new Error('Violation of UNIQUE KEY constraint');
  err.number = 2627;
  return err;
}

describe('campaignsRepository.recordVisit', () => {
  const visit = { code: 'influencerx', visitorId: 'v', ip: '1.2.3.4', userAgent: 'ua' };

  test('checa a campanha e a duplicata antes do INSERT, sem JOIN', async () => {
    const { query, inputs } = mockPool({ recordset: [{ outcome: 'recorded' }] });
    await expect(campaignsRepository.recordVisit(visit)).resolves.toBe('recorded');

    const text = query.mock.calls[0][0];
    const campaignAt = text.indexOf('FROM WebCampaigns WHERE Code = @code');
    const dupAt = text.indexOf('FROM WebCampaignVisits WHERE CampaignCode = @code AND VisitorId = @visitorId');
    const insertAt = text.indexOf('INSERT INTO WebCampaignVisits');
    expect(campaignAt).toBeGreaterThan(-1);
    expect(dupAt).toBeGreaterThan(campaignAt);
    expect(insertAt).toBeGreaterThan(dupAt);
    expect(text).not.toMatch(/JOIN/i);
    expect(inputs).toMatchObject({ code: 'influencerx', ip: '1.2.3.4', userAgent: 'ua' });
  });

  test('trunca user-agent longo para caber na coluna', async () => {
    const { inputs } = mockPool({ recordset: [{ outcome: 'recorded' }] });
    await campaignsRepository.recordVisit({ ...visit, userAgent: 'x'.repeat(400) });
    expect(inputs.userAgent).toHaveLength(255);
  });

  test('corrida na UNIQUE vira duplicate', async () => {
    mockPool(uniqueViolation());
    await expect(campaignsRepository.recordVisit(visit)).resolves.toBe('duplicate');
  });

  test('outros erros sobem', async () => {
    mockPool(new Error('timeout'));
    await expect(campaignsRepository.recordVisit(visit)).rejects.toThrow('timeout');
  });
});

describe('campaignsRepository.recordReferral', () => {
  const referral = { username: 'novo123', code: 'influencerx', visitorId: 'v', ip: '1.2.3.4' };

  test('só insere se a campanha estiver cadastrada, ligando a visita do navegador', async () => {
    const { query } = mockPool({ recordset: [{ recorded: true }] });
    await expect(campaignsRepository.recordReferral(referral)).resolves.toBe(true);

    const text = query.mock.calls[0][0];
    expect(text.indexOf('FROM WebCampaigns WHERE Code = @code')).toBeLessThan(text.indexOf('INSERT INTO WebAccountReferrals'));
    expect(text).toMatch(/SELECT Id FROM WebCampaignVisits WHERE CampaignCode = @code AND VisitorId = @visitorId/);
    expect(text).not.toMatch(/MEMB_INFO/);
  });

  test('campanha inexistente retorna false', async () => {
    mockPool({ recordset: [{ recorded: false }] });
    await expect(campaignsRepository.recordReferral(referral)).resolves.toBe(false);
  });

  test('conta já atribuída (PK) retorna false', async () => {
    mockPool(uniqueViolation());
    await expect(campaignsRepository.recordReferral(referral)).resolves.toBe(false);
  });
});
