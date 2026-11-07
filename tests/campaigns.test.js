// Links rastreáveis de campanha (mupro.vip/bonus/<codigo>): POST
// /campaigns/visit e o campo opcional `ref` do registro. Ver
// docs/SECTION_13_CAMPAIGN_LINKS.md.
process.env.RATE_LIMIT_CAMPAIGN_VISIT_MAX = '1000';

const request = require('supertest');

jest.mock('../src/db/accountsRepository');
jest.mock('../src/db/accountTokensRepository');
jest.mock('../src/db/auditLogRepository');
jest.mock('../src/db/campaignsRepository');
jest.mock('../src/services/emailService');

const app = require('../src/app');
const accountsRepository = require('../src/db/accountsRepository');
const auditLog = require('../src/db/auditLogRepository');
const campaignsRepository = require('../src/db/campaignsRepository');

const VISITOR = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/v1/campaigns/visit', () => {
  it('grava a visita com IP e user-agent, código em minúsculo', async () => {
    campaignsRepository.recordVisit.mockResolvedValue('recorded');

    const res = await request(app)
      .post('/api/v1/campaigns/visit')
      .set('User-Agent', 'jest-agent')
      .send({ code: 'InfluencerX', visitorId: VISITOR.toUpperCase() });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: true });
    expect(campaignsRepository.recordVisit).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'influencerx', visitorId: VISITOR, userAgent: 'jest-agent' }),
    );
    expect(campaignsRepository.recordVisit.mock.calls[0][0].ip).toBeTruthy();
  });

  it('responde recorded=false quando o navegador já tinha visitado', async () => {
    campaignsRepository.recordVisit.mockResolvedValue('duplicate');

    const res = await request(app).post('/api/v1/campaigns/visit').send({ code: 'influencerx', visitorId: VISITOR });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: false });
  });

  it('404 CAMPAIGN_NOT_FOUND para campanha não cadastrada', async () => {
    campaignsRepository.recordVisit.mockResolvedValue('not_found');

    const res = await request(app).post('/api/v1/campaigns/visit').send({ code: 'naoexiste', visitorId: VISITOR });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CAMPAIGN_NOT_FOUND');
  });

  it.each([
    [{ code: 'a', visitorId: VISITOR }],
    [{ code: 'tem espaço', visitorId: VISITOR }],
    [{ code: "x'; DROP TABLE x--", visitorId: VISITOR }],
    [{ code: 'influencerx', visitorId: 'nao-e-uuid' }],
    [{ code: 'influencerx' }],
  ])('400 para entrada inválida %j, sem tocar no banco', async (body) => {
    const res = await request(app).post('/api/v1/campaigns/visit').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(campaignsRepository.recordVisit).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/register com ref de campanha', () => {
  const account = { username: 'novo123', password: 'senha123', email: 'novo@example.com' };

  beforeEach(() => {
    accountsRepository.findByUsername.mockResolvedValue(null);
    accountsRepository.findAllByEmail.mockResolvedValue([]);
    accountsRepository.createAccount.mockResolvedValue({ created: true });
  });

  it('atribui a conta à campanha depois de criá-la e registra no audit log', async () => {
    campaignsRepository.recordReferral.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...account, ref: ' InfluencerX ', visitorId: VISITOR });

    expect(res.status).toBe(201);
    expect(campaignsRepository.recordReferral).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'novo123', code: 'influencerx', visitorId: VISITOR }),
    );
    expect(accountsRepository.createAccount.mock.invocationCallOrder[0]).toBeLessThan(
      campaignsRepository.recordReferral.mock.invocationCallOrder[0],
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'auth.register', success: true, details: { campaign: 'influencerx' } }),
    );
  });

  it('sem ref não tenta atribuir', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(account);

    expect(res.status).toBe(201);
    expect(campaignsRepository.recordReferral).not.toHaveBeenCalled();
  });

  it('ref fora do padrão é ignorado e a conta é criada', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...account, ref: 'código inválido!', visitorId: 'lixo' });

    expect(res.status).toBe(201);
    expect(campaignsRepository.recordReferral).not.toHaveBeenCalled();
  });

  it('visitorId inválido vira null, mas a atribuição acontece', async () => {
    campaignsRepository.recordReferral.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...account, ref: 'influencerx', visitorId: 'lixo' });

    expect(res.status).toBe(201);
    expect(campaignsRepository.recordReferral).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'influencerx', visitorId: null }),
    );
  });

  it('campanha removida: conta criada, audit log sem campanha', async () => {
    campaignsRepository.recordReferral.mockResolvedValue(false);

    const res = await request(app).post('/api/v1/auth/register').send({ ...account, ref: 'removida' });

    expect(res.status).toBe(201);
    const call = auditLog.record.mock.calls.find(([e]) => e.success);
    expect(call[0].details).toBeUndefined();
  });

  it('falha ao gravar a atribuição não derruba o registro', async () => {
    campaignsRepository.recordReferral.mockRejectedValue(new Error('Invalid object name WebAccountReferrals'));

    const res = await request(app).post('/api/v1/auth/register').send({ ...account, ref: 'influencerx' });

    expect(res.status).toBe(201);
  });

  it('não atribui quando o registro falha', async () => {
    accountsRepository.findByUsername.mockResolvedValue({ username: 'novo123' });

    const res = await request(app).post('/api/v1/auth/register').send({ ...account, ref: 'influencerx' });

    expect(res.status).toBe(409);
    expect(campaignsRepository.recordReferral).not.toHaveBeenCalled();
  });
});
