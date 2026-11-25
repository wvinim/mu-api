process.env.RATE_LIMIT_MARKET_WRITE_MAX = '1000';
process.env.MARKET_ENABLED = 'false';
process.env.MARKET_TESTERS = 'player1,player2';
process.env.ADMIN_USERNAMES = 'adminuser';

const request = require('supertest');

jest.mock('../src/db/marketRepository');
jest.mock('../src/db/accountsRepository');
jest.mock('../src/db/auditLogRepository');

const app = require('../src/app');
const marketRepository = require('../src/db/marketRepository');
const accountsRepository = require('../src/db/accountsRepository');
const auditLog = require('../src/db/auditLogRepository');
const tokenService = require('../src/services/tokenService');
const { makeItemBytes, makeVault } = require('./helpers/marketItems');

function authHeader(username = 'player1') {
  return `Bearer ${tokenService.issueAccessToken({ username })}`;
}

const EXC_HELM = makeItemBytes({ group: 7, index: 1, level: 9, exc: 0x21, luck: true, serial: 777 }); // Dragon Helm 2x2
const PLAIN_HELM = makeItemBytes({ group: 7, index: 1, level: 9 });

function listing(overrides = {}) {
  return {
    id: '42',
    itemBytes: EXC_HELM,
    itemGroup: 7,
    itemIndex: 1,
    itemName: 'Dragon Helm',
    width: 2,
    height: 2,
    price: 1000,
    createdAt: new Date('2026-11-24T00:00:00Z'),
    expiresAt: new Date('2026-12-01T00:00:00Z'),
    sellerAccount: 'player2',
    status: 'active',
    expired: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  accountsRepository.isAccountOnline.mockResolvedValue(false);
  marketRepository.countActiveBySeller.mockResolvedValue(0);
});

describe('acesso', () => {
  it('mercado desligado: conta fora de MARKET_TESTERS recebe 403', async () => {
    const res = await request(app).get('/api/v1/market/vaults').set('Authorization', authHeader('outsider'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MARKET_DISABLED');
  });

  it('exige login', async () => {
    const res = await request(app).get('/api/v1/market/listings');
    expect(res.status).toBe(401);
  });

  it('o catálogo é público', async () => {
    const res = await request(app).get('/api/v1/market/catalog');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(231);
    expect(res.body.rules).toEqual({ minPrice: 10, maxPrice: 10000, feePercent: 10, listingLimit: 10, listingDays: 7 });
  });

  it('seriais repetidos: só admin', async () => {
    marketRepository.findRepeatedSerials.mockResolvedValue([]);
    const asPlayer = await request(app).get('/api/v1/admin/market/repeated-serials').set('Authorization', authHeader('player1'));
    expect(asPlayer.status).toBe(403);
    const asAdmin = await request(app).get('/api/v1/admin/market/repeated-serials').set('Authorization', authHeader('adminuser'));
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body).toEqual({ serials: [] });
  });
});

describe('GET /market/vaults', () => {
  it('lista os baús com os itens e se cada um pode ser vendido', async () => {
    marketRepository.listVaults.mockResolvedValue({
      active: [{ vaultId: 0, items: makeVault({ 0: EXC_HELM, 2: PLAIN_HELM }), stored: false }],
      stored: [{ vaultId: 1, items: null, stored: true }],
    });
    const res = await request(app).get('/api/v1/market/vaults').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body.vaults).toHaveLength(2);
    expect(res.body.vaults[0]).toEqual(expect.objectContaining({ vaultId: 0, active: true }));
    const [exc, plain] = res.body.vaults[0].items;
    expect(exc).toEqual(expect.objectContaining({ slot: 0, sellable: true }));
    expect(exc.item).toEqual(expect.objectContaining({ name: 'Dragon Helm', level: 9, excellentCount: 2 }));
    expect(plain).toEqual(expect.objectContaining({ slot: 2, sellable: false }));
    expect(res.body.vaults[1]).toEqual({ vaultId: 1, active: false, items: [] });
  });
});

describe('POST /market/listings (anunciar)', () => {
  const vault = () => ({ vaultId: 0, items: makeVault({ 3: EXC_HELM }), stored: false });

  it('tira só o item do slot e chama a procedure com o baú lido', async () => {
    const v = vault();
    marketRepository.findVault.mockResolvedValue(v);
    marketRepository.createListing.mockResolvedValue({ Result: 0, ListingId: '99' });

    const res = await request(app)
      .post('/api/v1/market/listings')
      .set('Authorization', authHeader())
      .send({ vaultId: 0, slot: 3, price: 500 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 99, price: 500, item: 'Dragon Helm' });
    const call = marketRepository.createListing.mock.calls[0][0];
    expect(call).toEqual(expect.objectContaining({ accountId: 'player1', vaultId: 0, stored: false, slot: 3, price: 500 }));
    expect(call.oldItems.equals(v.items)).toBe(true);
    expect(call.newItems.equals(makeVault({}))).toBe(true);
    expect(call.itemBytes.equals(EXC_HELM)).toBe(true);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'market.listing_created', details: expect.objectContaining({ listingId: 99, serial: 777 }) }),
    );
  });

  it('recusa item que não é excelente sem chamar a procedure', async () => {
    marketRepository.findVault.mockResolvedValue({ vaultId: 0, items: makeVault({ 3: PLAIN_HELM }), stored: false });
    const res = await request(app)
      .post('/api/v1/market/listings')
      .set('Authorization', authHeader())
      .send({ vaultId: 0, slot: 3, price: 500 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEM_NOT_SELLABLE');
    expect(marketRepository.createListing).not.toHaveBeenCalled();
  });

  it('recusa preço fora da faixa', async () => {
    const res = await request(app)
      .post('/api/v1/market/listings')
      .set('Authorization', authHeader())
      .send({ vaultId: 0, slot: 3, price: 9 });
    expect(res.status).toBe(400);
  });

  it('baú mudou: relê e tenta de novo', async () => {
    marketRepository.findVault.mockResolvedValue(vault());
    marketRepository.createListing.mockResolvedValueOnce({ Result: 3 }).mockResolvedValueOnce({ Result: 0, ListingId: '7' });
    const res = await request(app)
      .post('/api/v1/market/listings')
      .set('Authorization', authHeader())
      .send({ vaultId: 0, slot: 3, price: 500 });
    expect(res.status).toBe(201);
    expect(marketRepository.findVault).toHaveBeenCalledTimes(2);
  });

  it('baú mudou 3 vezes: desiste com 409 e registra na auditoria', async () => {
    marketRepository.findVault.mockResolvedValue(vault());
    marketRepository.createListing.mockResolvedValue({ Result: 3 });
    const res = await request(app)
      .post('/api/v1/market/listings')
      .set('Authorization', authHeader())
      .send({ vaultId: 0, slot: 3, price: 500 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VAULT_CHANGED');
    expect(marketRepository.createListing).toHaveBeenCalledTimes(3);
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'market.listing_created', success: false }));
  });

  it.each([
    [1, 409, 'ACCOUNT_ONLINE'],
    [4, 409, 'LISTING_LIMIT'],
    [7, 500, 'MARKET_INVALID_OPERATION'],
  ])('Result %i da procedure vira %i %s', async (result, status, code) => {
    marketRepository.findVault.mockResolvedValue(vault());
    marketRepository.createListing.mockResolvedValue({ Result: result });
    const res = await request(app)
      .post('/api/v1/market/listings')
      .set('Authorization', authHeader())
      .send({ vaultId: 0, slot: 3, price: 500 });
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });

  it('trava ocupada no banco (1222): 503 e nada muda', async () => {
    marketRepository.findVault.mockResolvedValue(vault());
    marketRepository.createListing.mockRejectedValue(Object.assign(new Error('Lock request time out period exceeded.'), { number: 1222 }));
    const res = await request(app)
      .post('/api/v1/market/listings')
      .set('Authorization', authHeader())
      .send({ vaultId: 0, slot: 3, price: 500 });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('MARKET_BUSY');
  });

  it('conta com duas linhas de baú ativo não usa o mercado', async () => {
    marketRepository.findVault.mockResolvedValue({ duplicated: true });
    const res = await request(app)
      .post('/api/v1/market/listings')
      .set('Authorization', authHeader())
      .send({ vaultId: 0, slot: 3, price: 500 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VAULT_NOT_AVAILABLE');
  });
});

describe('POST /market/listings/:id/buy (comprar)', () => {
  it('põe o item no primeiro espaço 2x2 livre do baú escolhido', async () => {
    marketRepository.findListingById.mockResolvedValue(listing());
    // Kris (1x2) no slot 0: o elmo 2x2 vai para o slot 1.
    const vaultItems = makeVault({ 0: makeItemBytes({ group: 0, index: 0, exc: 1 }) });
    marketRepository.findVault.mockResolvedValue({ vaultId: 2, items: vaultItems, stored: true });
    marketRepository.buyListing.mockResolvedValue({ Result: 0, Price: 1000, SellerReceived: 900 });

    const res = await request(app)
      .post('/api/v1/market/listings/42/buy')
      .set('Authorization', authHeader())
      .send({ vaultId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, price: 1000, item: 'Dragon Helm', vaultId: 2, slot: 1 });
    const call = marketRepository.buyListing.mock.calls[0][0];
    expect(call).toEqual(expect.objectContaining({ listingId: 42, accountId: 'player1', vaultId: 2, stored: true, slot: 1 }));
    expect(call.newItems.subarray(16, 32).equals(EXC_HELM)).toBe(true);
    expect(call.oldItems.equals(vaultItems)).toBe(true);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'market.listing_bought', details: expect.objectContaining({ seller: 'player2', sellerReceived: 900 }) }),
    );
  });

  it('baú nunca usado (Items NULL) vai como oldItems null', async () => {
    marketRepository.findListingById.mockResolvedValue(listing());
    marketRepository.findVault.mockResolvedValue({ vaultId: 3, items: null, stored: true });
    marketRepository.buyListing.mockResolvedValue({ Result: 0, Price: 1000, SellerReceived: 900 });
    const res = await request(app).post('/api/v1/market/listings/42/buy').set('Authorization', authHeader()).send({ vaultId: 3 });
    expect(res.status).toBe(200);
    const call = marketRepository.buyListing.mock.calls[0][0];
    expect(call.oldItems).toBeNull();
    expect(call.slot).toBe(0);
  });

  it('não compra o próprio anúncio', async () => {
    marketRepository.findListingById.mockResolvedValue(listing({ sellerAccount: 'player1' }));
    const res = await request(app).post('/api/v1/market/listings/42/buy').set('Authorization', authHeader()).send({ vaultId: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OWN_LISTING');
    expect(marketRepository.buyListing).not.toHaveBeenCalled();
  });

  it('dono com outra caixa (Player1 vs player1) não é o mesmo dono', async () => {
    marketRepository.findListingById.mockResolvedValue(listing({ sellerAccount: 'Player1' }));
    marketRepository.findVault.mockResolvedValue({ vaultId: 0, items: makeVault({}), stored: false });
    marketRepository.buyListing.mockResolvedValue({ Result: 0, Price: 1000, SellerReceived: 900 });
    const res = await request(app).post('/api/v1/market/listings/42/buy').set('Authorization', authHeader()).send({ vaultId: 0 });
    expect(res.status).toBe(200);
  });

  it('anúncio expirado ou vendido: 409 sem chamar a procedure', async () => {
    marketRepository.findListingById.mockResolvedValue(listing({ expired: 1 }));
    const res = await request(app).post('/api/v1/market/listings/42/buy').set('Authorization', authHeader()).send({ vaultId: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LISTING_UNAVAILABLE');
    expect(marketRepository.buyListing).not.toHaveBeenCalled();
  });

  it('baú cheio: 409 antes de mexer no gold', async () => {
    marketRepository.findListingById.mockResolvedValue(listing());
    marketRepository.findVault.mockResolvedValue({ vaultId: 0, items: Buffer.alloc(1920, 0x00), stored: false });
    const res = await request(app).post('/api/v1/market/listings/42/buy').set('Authorization', authHeader()).send({ vaultId: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WAREHOUSE_FULL');
    expect(marketRepository.buyListing).not.toHaveBeenCalled();
  });

  it('gold insuficiente (Result 6): 402', async () => {
    marketRepository.findListingById.mockResolvedValue(listing());
    marketRepository.findVault.mockResolvedValue({ vaultId: 0, items: makeVault({}), stored: false });
    marketRepository.buyListing.mockResolvedValue({ Result: 6 });
    const res = await request(app).post('/api/v1/market/listings/42/buy').set('Authorization', authHeader()).send({ vaultId: 0 });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
  });

  it('baú inexistente: 404', async () => {
    marketRepository.findListingById.mockResolvedValue(listing());
    marketRepository.findVault.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/market/listings/42/buy').set('Authorization', authHeader()).send({ vaultId: 5 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VAULT_NOT_FOUND');
  });
});

describe('POST /market/listings/:id/return (retirar)', () => {
  it('só o dono retira', async () => {
    marketRepository.findListingById.mockResolvedValue(listing({ sellerAccount: 'player2' }));
    const res = await request(app).post('/api/v1/market/listings/42/return').set('Authorization', authHeader('player1')).send({ vaultId: 0 });
    expect(res.status).toBe(409);
    expect(marketRepository.returnListing).not.toHaveBeenCalled();
  });

  it('retira anúncio expirado para o baú escolhido', async () => {
    marketRepository.findListingById.mockResolvedValue(listing({ sellerAccount: 'player1', expired: 1 }));
    marketRepository.findVault.mockResolvedValue({ vaultId: 1, items: makeVault({}), stored: true });
    marketRepository.returnListing.mockResolvedValue({ Result: 0 });
    const res = await request(app).post('/api/v1/market/listings/42/return').set('Authorization', authHeader('player1')).send({ vaultId: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, vaultId: 1, slot: 0 });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'market.listing_returned', details: expect.objectContaining({ expired: true }) }),
    );
  });
});

describe('POST /market/listings/:id/renew', () => {
  it('renova expirado', async () => {
    marketRepository.renewListing.mockResolvedValue({ Result: 0 });
    marketRepository.findListingById.mockResolvedValue(listing({ sellerAccount: 'player1' }));
    const res = await request(app).post('/api/v1/market/listings/42/renew').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(42);
  });

  it('anúncio que não é seu ou não expirou: 409', async () => {
    marketRepository.renewListing.mockResolvedValue({ Result: 5 });
    const res = await request(app).post('/api/v1/market/listings/42/renew').set('Authorization', authHeader());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LISTING_NOT_RENEWABLE');
  });
});

describe('GET /market/listings (busca)', () => {
  it('converte filtros e devolve anúncios anônimos', async () => {
    marketRepository.searchListings.mockResolvedValue({ total: 1, rows: [listing()] });
    const res = await request(app)
      .get('/api/v1/market/listings?category=helm,armor&class=dk&minExc=2&luck=true&sort=price_asc')
      .set('Authorization', authHeader());
    expect(res.status).toBe(200);
    const [filters, paging] = marketRepository.searchListings.mock.calls[0];
    expect(filters.categories).toEqual(['helm', 'armor']);
    expect(filters.types).toContain(7 * 512 + 1);
    expect(filters.minExc).toBe(2);
    expect(filters.luck).toBe(true);
    expect(paging).toEqual({ page: 1, limit: 20, sort: 'price_asc' });
    expect(res.body.listings[0]).toEqual(expect.objectContaining({ id: 42, price: 1000 }));
    expect(res.body.listings[0]).not.toHaveProperty('sellerAccount');
    expect(res.body.listings[0].item).toEqual(expect.objectContaining({ name: 'Dragon Helm', image: 'Helm/Dragon Helm.jpg' }));
  });

  it('categoria inválida: 400', async () => {
    const res = await request(app).get('/api/v1/market/listings?category=jewel').set('Authorization', authHeader());
    expect(res.status).toBe(400);
  });
});
