// Precisa ser setado ANTES de qualquer require que carregue src/config/env.js
// (o módulo lê process.env uma única vez, na primeira importação).
process.env.RATE_LIMIT_LOGIN_MAX = '1000';
process.env.RATE_LIMIT_PURCHASE_MAX = '1000';
const WEBHOOK_SECRET = 'test-webhook-secret';
process.env.EFI_WEBHOOK_SECRET = WEBHOOK_SECRET;

const request = require('supertest');

jest.mock('../src/db/creditPackagesRepository');
jest.mock('../src/db/shopItemsRepository');
jest.mock('../src/db/shopBundlesRepository');
jest.mock('../src/db/pixChargesRepository');
jest.mock('../src/db/itemRedemptionsRepository');
jest.mock('../src/db/bundleRedemptionsRepository');
jest.mock('../src/db/shopHistoryRepository');
jest.mock('../src/db/accountsRepository');
jest.mock('../src/db/charactersRepository');
jest.mock('../src/db/auditLogRepository');
jest.mock('../src/services/efiClient');

const app = require('../src/app');
const creditPackagesRepository = require('../src/db/creditPackagesRepository');
const shopItemsRepository = require('../src/db/shopItemsRepository');
const shopBundlesRepository = require('../src/db/shopBundlesRepository');
const pixChargesRepository = require('../src/db/pixChargesRepository');
const itemRedemptionsRepository = require('../src/db/itemRedemptionsRepository');
const bundleRedemptionsRepository = require('../src/db/bundleRedemptionsRepository');
const shopHistoryRepository = require('../src/db/shopHistoryRepository');
const accountsRepository = require('../src/db/accountsRepository');
const charactersRepository = require('../src/db/charactersRepository');
const efiClient = require('../src/services/efiClient');
const tokenService = require('../src/services/tokenService');

const EMPTY_INVENTORY = Buffer.alloc(1728, 0xff);
const FULL_INVENTORY = Buffer.alloc(1728, 0x00);

const EMPTY_SLOT_BYTES = (() => {
  const buf = Buffer.alloc(16, 0x00);
  buf[0] = 0xff;
  buf[7] = 0x80;
  buf[9] = 0xf0;
  return buf;
})();

function inventoryWithFreeSlots(freeSlotIndexes) {
  const buf = Buffer.from(FULL_INVENTORY);
  for (const idx of freeSlotIndexes) {
    EMPTY_SLOT_BYTES.copy(buf, idx * 16);
  }
  return buf;
}

function makeBundleFixture() {
  return {
    Id: 5,
    Name: 'Pacote PK',
    PriceCredits: 900,
    Active: true,
    Items: [
      { ItemId: 2, ItemName: 'Jewel Pack', ItemGroup: 14, ItemIndex: 5, ItemLevel: 1, ItemQuantity: 1, ComponentQuantity: 2 },
      { ItemId: 3, ItemName: 'Kundun Box', ItemGroup: 14, ItemIndex: 30, ItemLevel: 0, ItemQuantity: 1, ComponentQuantity: 3 },
    ],
  };
}

function authHeader(username = 'player1') {
  return `Bearer ${tokenService.issueAccessToken({ username })}`;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/shop/items', () => {
  beforeEach(() => {
    shopBundlesRepository.findActiveWithItems.mockResolvedValue([]);
  });

  it('combina pacotes de crédito e itens em um catálogo único', async () => {
    creditPackagesRepository.findActive.mockResolvedValue([{ Id: 1, Name: '1000 Créditos', PriceCents: 1000, CreditsAmount: 1000 }]);
    shopItemsRepository.findActive.mockResolvedValue([{ Id: 2, Name: 'Bundle of Jewel', Description: 'x', PriceCredits: 500 }]);

    const res = await request(app).get('/api/v1/shop/items');

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { catalogId: 'credit:1', kind: 'credit_package', name: '1000 Créditos', priceCents: 1000, creditsAmount: 1000 },
      { catalogId: 'item:2', kind: 'game_item', name: 'Bundle of Jewel', description: 'x', priceCredits: 500 },
    ]);
  });

  it('inclui pacotes de itens (bundles) no catálogo, com o conteúdo resumido', async () => {
    creditPackagesRepository.findActive.mockResolvedValue([]);
    shopItemsRepository.findActive.mockResolvedValue([]);
    shopBundlesRepository.findActiveWithItems.mockResolvedValue([
      {
        Id: 5,
        Name: 'Pacote PK',
        Description: 'Joias + Kundun',
        PriceCredits: 900,
        Items: [
          { ItemId: 2, ItemName: 'Jewel Pack', ComponentQuantity: 10 },
          { ItemId: 3, ItemName: 'Kundun Box', ComponentQuantity: 10 },
        ],
      },
    ]);

    const res = await request(app).get('/api/v1/shop/items');

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        catalogId: 'bundle:5',
        kind: 'item_bundle',
        name: 'Pacote PK',
        description: 'Joias + Kundun',
        priceCredits: 900,
        items: [
          { name: 'Jewel Pack', quantity: 10 },
          { name: 'Kundun Box', quantity: 10 },
        ],
      },
    ]);
  });
});

describe('POST /api/v1/shop/purchase — pacote de créditos', () => {
  it('cria uma cobrança Pix e retorna o QR code', async () => {
    creditPackagesRepository.findById.mockResolvedValue({ Id: 1, Name: '1000 Créditos', PriceCents: 1000, CreditsAmount: 1000, Active: true });
    efiClient.createImmediateCharge.mockResolvedValue({ txid: 'abc123', pixCopiaECola: '00020126...', qrCodeImage: 'data:image/png;base64,...' });
    pixChargesRepository.create.mockResolvedValue();

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'credit:1' });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('pix_charge');
    expect(res.body.txid).toBe('abc123');
    expect(pixChargesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'player1', packageId: 1, txid: 'abc123', creditsAmount: 1000 }),
    );
  });

  it('retorna 404 para pacote inexistente', async () => {
    creditPackagesRepository.findById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'credit:999' });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/shop/purchase — resgate de item', () => {
  it('exige characterName', async () => {
    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'item:2' });

    expect(res.status).toBe(400);
  });

  it('rejeita personagem que não pertence à conta', async () => {
    shopItemsRepository.findById.mockResolvedValue({ Id: 2, Name: 'Item', PriceCredits: 100, ItemGroup: 14, ItemIndex: 0, ItemLevel: 0, Quantity: 1, Active: true });
    charactersRepository.findOwnedCharacter.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'item:2', characterName: 'NaoEMeu' });

    expect(res.status).toBe(404);
    expect(accountsRepository.debitCash).not.toHaveBeenCalled();
  });

  it('rejeita quando não há créditos suficientes', async () => {
    shopItemsRepository.findById.mockResolvedValue({ Id: 2, Name: 'Item', PriceCredits: 100, ItemGroup: 14, ItemIndex: 0, ItemLevel: 0, Quantity: 1, Active: true });
    charactersRepository.findOwnedCharacter.mockResolvedValue({ Name: 'Hero1' });
    accountsRepository.debitCash.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'item:2', characterName: 'Hero1' });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(charactersRepository.updateInventory).not.toHaveBeenCalled();
  });

  it('insere o item na mochila (slot 12-75) e nunca em slot de equipamento', async () => {
    shopItemsRepository.findById.mockResolvedValue({ Id: 2, Name: 'Bundle', PriceCredits: 100, ItemGroup: 14, ItemIndex: 5, ItemLevel: 1, Quantity: 10, Active: true });
    charactersRepository.findOwnedCharacter.mockResolvedValue({ Name: 'Hero1' });
    accountsRepository.debitCash.mockResolvedValue(true);
    charactersRepository.getInventoryBuffer.mockResolvedValue(Buffer.from(EMPTY_INVENTORY));
    charactersRepository.updateInventory.mockResolvedValue();
    itemRedemptionsRepository.create.mockResolvedValue();

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'item:2', characterName: 'Hero1' });

    expect(res.status).toBe(201);
    expect(res.body.slot).toBeGreaterThanOrEqual(12);
    expect(res.body.slot).toBeLessThan(76);

    const [, savedBuffer] = charactersRepository.updateInventory.mock.calls[0];
    const slotOffset = res.body.slot * 16;
    expect(savedBuffer[slotOffset]).not.toBe(0xff); // slot deixou de estar vazio
    // slots de equipamento (0-11) continuam intocados.
    for (let i = 0; i < 12 * 16; i++) {
      expect(savedBuffer[i]).toBe(0xff);
    }
  });

  it('estorna os créditos se a mochila estiver cheia', async () => {
    shopItemsRepository.findById.mockResolvedValue({ Id: 2, Name: 'Item', PriceCredits: 100, ItemGroup: 14, ItemIndex: 0, ItemLevel: 0, Quantity: 1, Active: true });
    charactersRepository.findOwnedCharacter.mockResolvedValue({ Name: 'Hero1' });
    accountsRepository.debitCash.mockResolvedValue(true);
    charactersRepository.getInventoryBuffer.mockResolvedValue(Buffer.from(FULL_INVENTORY));

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'item:2', characterName: 'Hero1' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVENTORY_FULL');
    expect(accountsRepository.creditCash).toHaveBeenCalledWith('player1', 100);
    expect(itemRedemptionsRepository.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/shop/purchase — resgate de pacote (bundle)', () => {
  it('exige characterName', async () => {
    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'bundle:5' });

    expect(res.status).toBe(400);
  });

  it('retorna 404 para pacote inexistente ou inativo', async () => {
    shopBundlesRepository.findById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'bundle:5', characterName: 'Hero1' });

    expect(res.status).toBe(404);
    expect(accountsRepository.debitCash).not.toHaveBeenCalled();
  });

  it('rejeita personagem que não pertence à conta', async () => {
    shopBundlesRepository.findById.mockResolvedValue(makeBundleFixture());
    charactersRepository.findOwnedCharacter.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'bundle:5', characterName: 'NaoEMeu' });

    expect(res.status).toBe(404);
    expect(accountsRepository.debitCash).not.toHaveBeenCalled();
  });

  it('rejeita quando não há créditos suficientes', async () => {
    shopBundlesRepository.findById.mockResolvedValue(makeBundleFixture());
    charactersRepository.findOwnedCharacter.mockResolvedValue({ Name: 'Hero1' });
    accountsRepository.debitCash.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'bundle:5', characterName: 'Hero1' });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(charactersRepository.updateInventory).not.toHaveBeenCalled();
  });

  it('insere todos os itens do pacote (2 Jewel Pack + 3 Kundun Box) em slots distintos da mochila', async () => {
    shopBundlesRepository.findById.mockResolvedValue(makeBundleFixture());
    charactersRepository.findOwnedCharacter.mockResolvedValue({ Name: 'Hero1' });
    accountsRepository.debitCash.mockResolvedValue(true);
    charactersRepository.getInventoryBuffer.mockResolvedValue(Buffer.from(EMPTY_INVENTORY));
    charactersRepository.updateInventory.mockResolvedValue();
    bundleRedemptionsRepository.create.mockResolvedValue();

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'bundle:5', characterName: 'Hero1' });

    expect(res.status).toBe(201);
    expect(res.body.slots).toHaveLength(5); // 2 + 3
    expect(new Set(res.body.slots).size).toBe(5); // slots distintos
    for (const slot of res.body.slots) {
      expect(slot).toBeGreaterThanOrEqual(12);
      expect(slot).toBeLessThan(76);
    }

    // Debita o preço do PACOTE (900), não a soma de itens individuais.
    expect(accountsRepository.debitCash).toHaveBeenCalledWith('player1', 900);
    // Uma única linha de resgate para a compra inteira do pacote.
    expect(bundleRedemptionsRepository.create).toHaveBeenCalledTimes(1);
    expect(bundleRedemptionsRepository.create).toHaveBeenCalledWith({
      accountId: 'player1',
      characterName: 'Hero1',
      bundleId: 5,
      priceCredits: 900,
    });

    const [, savedBuffer] = charactersRepository.updateInventory.mock.calls[0];
    // slots de equipamento (0-11) continuam intocados.
    for (let i = 0; i < 12 * 16; i++) {
      expect(savedBuffer[i]).toBe(0xff);
    }
  });

  it('estorna os créditos e não grava nada se faltar espaço para TODOS os itens do pacote', async () => {
    shopBundlesRepository.findById.mockResolvedValue(makeBundleFixture());
    charactersRepository.findOwnedCharacter.mockResolvedValue({ Name: 'Hero1' });
    accountsRepository.debitCash.mockResolvedValue(true);
    // Só 3 slots livres na mochila, mas o pacote precisa de 5 (2 + 3).
    charactersRepository.getInventoryBuffer.mockResolvedValue(inventoryWithFreeSlots([12, 13, 14]));

    const res = await request(app)
      .post('/api/v1/shop/purchase')
      .set('Authorization', authHeader())
      .send({ catalogId: 'bundle:5', characterName: 'Hero1' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVENTORY_FULL');
    expect(accountsRepository.creditCash).toHaveBeenCalledWith('player1', 900);
    expect(charactersRepository.updateInventory).not.toHaveBeenCalled();
    expect(bundleRedemptionsRepository.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/shop/credits e /shop/history', () => {
  it('retorna o saldo de Cash da conta', async () => {
    accountsRepository.findByUsername.mockResolvedValue({ cash: 4200 });
    const res = await request(app).get('/api/v1/shop/credits').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body.cash).toBe(4200);
  });

  it('retorna o histórico paginado', async () => {
    shopHistoryRepository.findByAccount.mockResolvedValue({ items: [], total: 0 });
    const res = await request(app).get('/api/v1/shop/history').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(shopHistoryRepository.findByAccount).toHaveBeenCalledWith('player1', { page: 1, limit: 20 });
  });
});

describe('POST /api/v1/shop/payment/webhook/:secret', () => {
  it('rejeita segredo incorreto com 404', async () => {
    const res = await request(app).post('/api/v1/shop/payment/webhook/segredo-errado').send({ pix: [] });
    expect(res.status).toBe(404);
  });

  it('credita Cash quando a cobrança é confirmada como CONCLUIDA e ainda não processada', async () => {
    efiClient.getChargeStatus.mockResolvedValue({ status: 'CONCLUIDA' });
    pixChargesRepository.findByTxId.mockResolvedValue({ AccountId: 'player1', CreditsAmount: 1000 });
    pixChargesRepository.markPaid.mockResolvedValue(true);
    accountsRepository.creditCash.mockResolvedValue();

    const res = await request(app)
      .post(`/api/v1/shop/payment/webhook/${WEBHOOK_SECRET}`)
      .send({ pix: [{ txid: 'abc123' }] });

    expect(res.status).toBe(200);
    expect(accountsRepository.creditCash).toHaveBeenCalledWith('player1', 1000);
  });

  it('não credita de novo se o txid já foi processado (idempotência)', async () => {
    efiClient.getChargeStatus.mockResolvedValue({ status: 'CONCLUIDA' });
    pixChargesRepository.findByTxId.mockResolvedValue({ AccountId: 'player1', CreditsAmount: 1000 });
    pixChargesRepository.markPaid.mockResolvedValue(false); // já estava pago

    const res = await request(app)
      .post(`/api/v1/shop/payment/webhook/${WEBHOOK_SECRET}`)
      .send({ pix: [{ txid: 'abc123' }] });

    expect(res.status).toBe(200);
    expect(accountsRepository.creditCash).not.toHaveBeenCalled();
  });

  it('não credita se a reconsulta na Efí não confirma pagamento', async () => {
    efiClient.getChargeStatus.mockResolvedValue({ status: 'ATIVA' });

    const res = await request(app)
      .post(`/api/v1/shop/payment/webhook/${WEBHOOK_SECRET}`)
      .send({ pix: [{ txid: 'abc123' }] });

    expect(res.status).toBe(200);
    expect(pixChargesRepository.markPaid).not.toHaveBeenCalled();
    expect(accountsRepository.creditCash).not.toHaveBeenCalled();
  });
});
