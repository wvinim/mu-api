const request = require('supertest');

jest.mock('../src/db/charactersRepository');

const app = require('../src/app');
const charactersRepository = require('../src/db/charactersRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/characters/:name', () => {
  it('não existe mais (página do personagem removida em 2026-10-06)', async () => {
    const res = await request(app).get('/api/v1/characters/Hero1');

    expect(res.status).toBe(404);
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
    expect(charactersRepository.findRanking).toHaveBeenCalledWith({ page: 1, limit: 20, raceCode: undefined });
  });

  it('rejeita limit acima de 100', async () => {
    const res = await request(app).get('/api/v1/characters/ranking?limit=999');
    expect(res.status).toBe(400);
  });

  it('classCode filtra pela raça inteira (Grand Master=3 vira raça 0)', async () => {
    charactersRepository.findRanking.mockResolvedValue({ items: [], total: 0 });

    const res = await request(app).get('/api/v1/characters/ranking?classCode=3&page=2&limit=5');

    expect(res.status).toBe(200);
    expect(charactersRepository.findRanking).toHaveBeenCalledWith({ page: 2, limit: 5, raceCode: 0 });
  });

  it('classCodes da mesma raça dividem a entrada de cache; raças diferentes não', async () => {
    charactersRepository.findRanking.mockResolvedValue({ items: [], total: 0 });

    await request(app).get('/api/v1/characters/ranking?classCode=16&limit=7');
    await request(app).get('/api/v1/characters/ranking?classCode=19&limit=7');
    expect(charactersRepository.findRanking).toHaveBeenCalledTimes(1);
    expect(charactersRepository.findRanking).toHaveBeenCalledWith({ page: 1, limit: 7, raceCode: 16 });

    await request(app).get('/api/v1/characters/ranking?classCode=32&limit=7');
    expect(charactersRepository.findRanking).toHaveBeenCalledTimes(2);
    expect(charactersRepository.findRanking).toHaveBeenLastCalledWith({ page: 1, limit: 7, raceCode: 32 });
  });
});
