const request = require('supertest');

jest.mock('../src/db/charactersRepository');

const app = require('../src/app');
const charactersRepository = require('../src/db/charactersRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/characters/:name', () => {
  it('retorna 404 quando o personagem não existe', async () => {
    charactersRepository.findPublicByName.mockResolvedValue(null);

    const res = await request(app).get('/api/v1/characters/Ghost');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('retorna o perfil público do personagem, sem money/posição/accountId', async () => {
    const publicProfile = { name: 'Hero1', level: 400, classCode: 22, resets: 10 };
    charactersRepository.findPublicByName.mockResolvedValue(publicProfile);

    const res = await request(app).get('/api/v1/characters/Hero1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(publicProfile);
    expect(res.body.money).toBeUndefined();
    expect(res.body.accountId).toBeUndefined();
    expect(res.body.mapPosX).toBeUndefined();
  });
});

describe('GET /api/v1/characters/ranking', () => {
  it('usa paginação padrão e cacheia o resultado por parâmetro', async () => {
    charactersRepository.findRanking.mockResolvedValue({ items: [{ name: 'Hero1', rank: 1 }], total: 1 });

    const res1 = await request(app).get('/api/v1/characters/ranking');
    const res2 = await request(app).get('/api/v1/characters/ranking');

    expect(res1.status).toBe(200);
    expect(res1.body.total).toBe(1);
    expect(res2.body).toEqual(res1.body);
    // A segunda chamada com os mesmos parâmetros deve vir do cache.
    expect(charactersRepository.findRanking).toHaveBeenCalledTimes(1);
    expect(charactersRepository.findRanking).toHaveBeenCalledWith({ page: 1, limit: 20, classCode: undefined });
  });

  it('rejeita limit acima de 100', async () => {
    const res = await request(app).get('/api/v1/characters/ranking?limit=999');
    expect(res.status).toBe(400);
  });

  it('aceita filtro por classCode', async () => {
    charactersRepository.findRanking.mockResolvedValue({ items: [], total: 0 });

    const res = await request(app).get('/api/v1/characters/ranking?classCode=22&page=2&limit=5');

    expect(res.status).toBe(200);
    expect(charactersRepository.findRanking).toHaveBeenCalledWith({ page: 2, limit: 5, classCode: 22 });
  });
});
