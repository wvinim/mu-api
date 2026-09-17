process.env.RATE_LIMIT_LOGIN_MAX = '1000';

const request = require('supertest');

jest.mock('../src/db/accountsRepository');
jest.mock('../src/db/charactersRepository');
jest.mock('../src/db/auditLogRepository');
jest.mock('../src/db/autopickRepository');

const app = require('../src/app');
const accountsRepository = require('../src/db/accountsRepository');
const charactersRepository = require('../src/db/charactersRepository');
const auditLogRepository = require('../src/db/auditLogRepository');
const autopickRepository = require('../src/db/autopickRepository');
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

describe('GET /api/v1/account/autopick', () => {
  it('retorna a seleção salva, com o nome do item resolvido', async () => {
    autopickRepository.findByAccount.mockResolvedValue([{ ItemGroup: 14, ItemIndex: 13, ItemLevel: 0 }]);

    const res = await request(app).get('/api/v1/account/autopick').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ itemGroup: 14, itemIndex: 13, itemLevel: 0, name: 'Jewel of Bless' }]);
  });

  it('não exige ser Mega Vip pra consultar (mostra o que já foi salvo antes)', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount({ vip: 0 }));
    autopickRepository.findByAccount.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/account/autopick').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(accountsRepository.findByUsername).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/account/autopick', () => {
  it('rejeita se a conta não é Mega Vip (tier 3) no momento', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount({ vip: 2 }));

    const res = await request(app)
      .put('/api/v1/account/autopick')
      .set('Authorization', authHeader())
      .send({ items: [{ itemGroup: 14, itemIndex: 13, itemLevel: 0 }] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MEGA_VIP_REQUIRED');
    expect(autopickRepository.replaceAll).not.toHaveBeenCalled();
  });

  it('rejeita item fora da lista fechada permitida', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount({ vip: 3 }));

    const res = await request(app)
      .put('/api/v1/account/autopick')
      .set('Authorization', authHeader())
      .send({ items: [{ itemGroup: 99, itemIndex: 99, itemLevel: 0 }] });

    expect(res.status).toBe(400);
    expect(autopickRepository.replaceAll).not.toHaveBeenCalled();
  });

  it('rejeita mais de 12 itens (tamanho da lista fechada)', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount({ vip: 3 }));

    const res = await request(app)
      .put('/api/v1/account/autopick')
      .set('Authorization', authHeader())
      .send({ items: Array.from({ length: 13 }, () => ({ itemGroup: 14, itemIndex: 13, itemLevel: 0 })) });

    expect(res.status).toBe(400);
  });

  it('rejeita se a conta estiver online no jogo, sem gravar nada', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount({ vip: 3 }));
    accountsRepository.isAccountOnline.mockResolvedValue(true);

    const res = await request(app)
      .put('/api/v1/account/autopick')
      .set('Authorization', authHeader())
      .send({ items: [{ itemGroup: 14, itemIndex: 13, itemLevel: 0 }] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHARACTER_ONLINE');
    expect(autopickRepository.replaceAll).not.toHaveBeenCalled();
  });

  it('substitui a seleção inteira quando a conta é Mega Vip e está offline', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount({ vip: 3 }));
    accountsRepository.isAccountOnline.mockResolvedValue(false);
    autopickRepository.replaceAll.mockResolvedValue();

    const items = [
      { itemGroup: 14, itemIndex: 13, itemLevel: 0 }, // Jewel of Bless
      { itemGroup: 14, itemIndex: 11, itemLevel: 8 }, // Box of Kundun +1
    ];

    const res = await request(app)
      .put('/api/v1/account/autopick')
      .set('Authorization', authHeader())
      .send({ items });

    expect(res.status).toBe(200);
    expect(autopickRepository.replaceAll).toHaveBeenCalledWith('player1', items);
    expect(auditLogRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'player1', eventType: 'account.autopick_updated' }),
    );
  });
});
