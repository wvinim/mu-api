process.env.RATE_LIMIT_LOGIN_MAX = '1000';

const request = require('supertest');

jest.mock('../src/db/accountsRepository');
jest.mock('../src/db/charactersRepository');
jest.mock('../src/db/auditLogRepository');

const app = require('../src/app');
const accountsRepository = require('../src/db/accountsRepository');
const charactersRepository = require('../src/db/charactersRepository');
const auditLogRepository = require('../src/db/auditLogRepository');
const tokenService = require('../src/services/tokenService');

function makeAccount(overrides = {}) {
  return {
    username: 'player1',
    displayName: 'player1',
    email: 'player1@example.com',
    emailConfirmed: true,
    banned: false,
    cash: 100,
    vip: 0,
    vipStartDate: null,
    vipEndDate: null,
    webPasswordHash: 'hash',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function authHeader(account = makeAccount()) {
  return `Bearer ${tokenService.issueAccessToken(account)}`;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/account/me', () => {
  it('exige token de acesso', async () => {
    const res = await request(app).get('/api/v1/account/me');
    expect(res.status).toBe(401);
  });

  it('retorna o perfil da conta autenticada', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount());

    const res = await request(app).get('/api/v1/account/me').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('player1');
    expect(res.body.role).toBe('player');
    expect(accountsRepository.findByUsername).toHaveBeenCalledWith('player1');
  });
});

describe('PATCH /api/v1/account/me', () => {
  it('rejeita displayName maior que 10 caracteres', async () => {
    const res = await request(app)
      .patch('/api/v1/account/me')
      .set('Authorization', authHeader())
      .send({ displayName: 'nomeGigantesco' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(accountsRepository.updateProfile).not.toHaveBeenCalled();
  });

  it('atualiza o displayName e audita a alteração', async () => {
    accountsRepository.updateProfile.mockResolvedValue();

    const res = await request(app)
      .patch('/api/v1/account/me')
      .set('Authorization', authHeader())
      .send({ displayName: 'NovoNome' });

    expect(res.status).toBe(200);
    expect(accountsRepository.updateProfile).toHaveBeenCalledWith('player1', { displayName: 'NovoNome' });
    expect(auditLogRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'player1', eventType: 'account.update_profile' }),
    );
  });
});

describe('GET /api/v1/account/characters', () => {
  it('retorna os personagens da conta autenticada', async () => {
    charactersRepository.findByAccountId.mockResolvedValue([{ name: 'Hero1', level: 400 }]);

    const res = await request(app).get('/api/v1/account/characters').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.characters).toEqual([{ name: 'Hero1', level: 400 }]);
    expect(charactersRepository.findByAccountId).toHaveBeenCalledWith('player1');
  });
});

describe('GET /api/v1/account/security-log', () => {
  it('usa paginação padrão (page=1, limit=20)', async () => {
    auditLogRepository.findByAccount.mockResolvedValue({ items: [], total: 0 });

    const res = await request(app).get('/api/v1/account/security-log').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(auditLogRepository.findByAccount).toHaveBeenCalledWith('player1', { page: 1, limit: 20 });
  });

  it('rejeita limit acima de 100', async () => {
    const res = await request(app)
      .get('/api/v1/account/security-log?limit=500')
      .set('Authorization', authHeader());

    expect(res.status).toBe(400);
  });
});
