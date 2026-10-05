const request = require('supertest');

jest.mock('../src/db/showcaseRepository');
jest.mock('../src/db/accountsRepository');

const app = require('../src/app');
const showcaseRepository = require('../src/db/showcaseRepository');
const accountsRepository = require('../src/db/accountsRepository');
const tokenService = require('../src/services/tokenService');
const codec = require('../src/services/itemSlotCodec');

function authHeader(username = 'player1') {
  return `Bearer ${tokenService.issueAccessToken({ username })}`;
}

/** Baú 8x15 com Jewel of Bless no slot 0, Dark Horse (oculto) no 1 e Katana no 10. */
function showcaseBuffer() {
  const buffer = Buffer.alloc(16 * 120, 0xff);
  codec.makeSimpleItemSlot({ itemGroup: 14, itemIndex: 13 }).copy(buffer, 0);
  codec.makeSimpleItemSlot({ itemGroup: 13, itemIndex: 4 }).copy(buffer, 16);
  codec.makeSimpleItemSlot({ itemGroup: 0, itemIndex: 3, itemLevel: 7 }).copy(buffer, 10 * 16);
  return buffer;
}

const STORED_AT = new Date('2026-10-05T12:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/showcase/:name', () => {
  it('mostra a vitrine guardada do personagem de contato, sem itens ocultos', async () => {
    showcaseRepository.findContactByCharacter.mockResolvedValue({ AccountId: 'acc1', CharacterName: 'Vendedor', UpdatedAt: STORED_AT });
    showcaseRepository.findStoredShowcase.mockResolvedValue({ items: showcaseBuffer(), storedAt: STORED_AT });
    accountsRepository.isAccountOnline.mockResolvedValue(true);

    const res = await request(app).get('/api/v1/showcase/Vendedor');

    expect(res.status).toBe(200);
    expect(res.body.character).toBe('Vendedor');
    expect(res.body.online).toBe(true);
    expect(res.body.items.map((i) => [i.slot, i.name])).toEqual([
      [0, 'Jewel of Bless'],
      [10, 'Katana'],
    ]);
    expect(res.body.items[1].level).toBe(7);
    expect(res.body).not.toHaveProperty('accountId'); // não expõe a conta
    expect(showcaseRepository.findStoredShowcase).toHaveBeenCalledWith('acc1');
  });

  it('404 quando o personagem não é contato de nenhuma vitrine', async () => {
    showcaseRepository.findContactByCharacter.mockResolvedValue(null);

    const res = await request(app).get('/api/v1/showcase/Ninguem');

    expect(res.status).toBe(404);
    expect(showcaseRepository.findStoredShowcase).not.toHaveBeenCalled();
  });

  it('404 quando a vitrine nunca foi guardada (só existe ativa, em edição)', async () => {
    showcaseRepository.findContactByCharacter.mockResolvedValue({ AccountId: 'acc2', CharacterName: 'Editando', UpdatedAt: STORED_AT });
    showcaseRepository.findStoredShowcase.mockResolvedValue(null);

    const res = await request(app).get('/api/v1/showcase/Editando');

    expect(res.status).toBe(404);
  });

  it('rejeita nome maior que 10 caracteres', async () => {
    const res = await request(app).get('/api/v1/showcase/NomeGrandeDemais');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/showcase/me', () => {
  it('exige login', async () => {
    const res = await request(app).get('/api/v1/showcase/me');
    expect(res.status).toBe(401);
  });

  it('indica edição quando o baú ativo é o do mercado (VaultID 200)', async () => {
    showcaseRepository.findContactByAccount.mockResolvedValue({ AccountId: 'player1', CharacterName: 'Vendedor', UpdatedAt: STORED_AT });
    showcaseRepository.findStoredShowcase.mockResolvedValue(null);
    showcaseRepository.findActiveVaultId.mockResolvedValue(200);

    const res = await request(app).get('/api/v1/showcase/me').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ character: 'Vendedor', editing: true, storedAt: null, items: [] });
  });

  it('lista a vitrine guardada da própria conta', async () => {
    showcaseRepository.findContactByAccount.mockResolvedValue({ AccountId: 'player1', CharacterName: 'Vendedor', UpdatedAt: STORED_AT });
    showcaseRepository.findStoredShowcase.mockResolvedValue({ items: showcaseBuffer(), storedAt: STORED_AT });
    showcaseRepository.findActiveVaultId.mockResolvedValue(0);

    const res = await request(app).get('/api/v1/showcase/me').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.editing).toBe(false);
    expect(res.body.items).toHaveLength(2);
    expect(showcaseRepository.findStoredShowcase).toHaveBeenCalledWith('player1');
  });
});
