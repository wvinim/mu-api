process.env.ADMIN_USERNAMES = 'adminuser';
process.env.STAFF_USERNAMES = 'staffuser';

const request = require('supertest');

jest.mock('../src/db/accountsRepository');
jest.mock('../src/db/auditLogRepository');
jest.mock('../src/db/shopItemsRepository');
jest.mock('../src/db/creditPackagesRepository');
jest.mock('../src/db/refreshTokensRepository');

const app = require('../src/app');
const accountsRepository = require('../src/db/accountsRepository');
const shopItemsRepository = require('../src/db/shopItemsRepository');
const creditPackagesRepository = require('../src/db/creditPackagesRepository');
const refreshTokensRepository = require('../src/db/refreshTokensRepository');
const tokenService = require('../src/services/tokenService');

function authHeader(username) {
  return `Bearer ${tokenService.issueAccessToken({ username })}`;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('autorização reforçada em /admin', () => {
  it('jogador comum recebe 403', async () => {
    const res = await request(app).get('/api/v1/admin/accounts').set('Authorization', authHeader('player1'));
    expect(res.status).toBe(403);
  });

  it('staff também recebe 403 — só admin acessa /admin', async () => {
    const res = await request(app).get('/api/v1/admin/accounts').set('Authorization', authHeader('staffuser'));
    expect(res.status).toBe(403);
  });

  it('admin acessa normalmente', async () => {
    accountsRepository.findAllPaginated.mockResolvedValue({ items: [], total: 0 });
    const res = await request(app).get('/api/v1/admin/accounts').set('Authorization', authHeader('adminuser'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/admin/accounts/:id/ban e /unban', () => {
  it('retorna 404 para conta inexistente', async () => {
    accountsRepository.findByUsername.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/v1/admin/accounts/ghost/ban')
      .set('Authorization', authHeader('adminuser'));
    expect(res.status).toBe(404);
  });

  it('bane a conta e revoga os refresh tokens ativos', async () => {
    accountsRepository.findByUsername.mockResolvedValue({ username: 'player1' });
    accountsRepository.setBanned.mockResolvedValue();
    refreshTokensRepository.revokeAllForAccount.mockResolvedValue();

    const res = await request(app)
      .post('/api/v1/admin/accounts/player1/ban')
      .set('Authorization', authHeader('adminuser'));

    expect(res.status).toBe(200);
    expect(accountsRepository.setBanned).toHaveBeenCalledWith('player1', true);
    expect(refreshTokensRepository.revokeAllForAccount).toHaveBeenCalledWith('player1');
  });

  it('desbane a conta', async () => {
    accountsRepository.findByUsername.mockResolvedValue({ username: 'player1' });
    accountsRepository.setBanned.mockResolvedValue();

    const res = await request(app)
      .post('/api/v1/admin/accounts/player1/unban')
      .set('Authorization', authHeader('adminuser'));

    expect(res.status).toBe(200);
    expect(accountsRepository.setBanned).toHaveBeenCalledWith('player1', false);
  });
});

describe('CRUD de itens da loja', () => {
  it('cria um item novo', async () => {
    shopItemsRepository.create.mockResolvedValue(10);

    const res = await request(app)
      .post('/api/v1/admin/shop/items')
      .set('Authorization', authHeader('adminuser'))
      .send({ name: 'Bundle', priceCredits: 500, itemGroup: 14, itemIndex: 13 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(10);
    expect(shopItemsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bundle', priceCredits: 500, itemGroup: 14, itemIndex: 13, itemLevel: 0, quantity: 1, active: true }),
    );
  });

  it('rejeita update sem nenhum campo', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/shop/items/10')
      .set('Authorization', authHeader('adminuser'))
      .send({});
    expect(res.status).toBe(400);
  });

  it('desativa (soft delete) um item', async () => {
    shopItemsRepository.setActive.mockResolvedValue();
    const res = await request(app)
      .delete('/api/v1/admin/shop/items/10')
      .set('Authorization', authHeader('adminuser'));
    expect(res.status).toBe(200);
    expect(shopItemsRepository.setActive).toHaveBeenCalledWith(10, false);
  });
});

describe('CRUD de pacotes de crédito', () => {
  it('cria um pacote novo', async () => {
    creditPackagesRepository.create.mockResolvedValue(3);
    const res = await request(app)
      .post('/api/v1/admin/shop/credit-packages')
      .set('Authorization', authHeader('adminuser'))
      .send({ name: '1000 Créditos', priceCents: 1000, creditsAmount: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(3);
  });
});
