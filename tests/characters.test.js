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
  const ok = (extra = {}) => ({ items: [{ name: 'Hero1', rank: 1 }], periodStart: null, periodEnd: null, ...extra });

  it('padrão = total, top 10; cacheia por parâmetro', async () => {
    charactersRepository.findRanking.mockResolvedValue(ok());

    const res1 = await request(app).get('/api/v1/characters/ranking');
    const res2 = await request(app).get('/api/v1/characters/ranking');

    expect(res1.status).toBe(200);
    expect(res1.body).toMatchObject({ period: 'total', previous: false, page: 1, limit: 10, total: 1 });
    expect(res2.body).toEqual(res1.body);
    expect(charactersRepository.findRanking).toHaveBeenCalledTimes(1);
    expect(charactersRepository.findRanking).toHaveBeenCalledWith({
      period: 'total',
      previous: false,
      limit: 10,
      raceCode: undefined,
    });
  });

  it('limit acima de 10 vira 10 (front antigo manda 20); acima de 100 é 400', async () => {
    charactersRepository.findRanking.mockResolvedValue(ok());

    const res = await request(app).get('/api/v1/characters/ranking?page=3&limit=20&period=day');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(10);
    expect(charactersRepository.findRanking).toHaveBeenCalledWith(expect.objectContaining({ period: 'day', limit: 10 }));

    expect((await request(app).get('/api/v1/characters/ranking?limit=999')).status).toBe(400);
  });

  it('limit menor que 10 é respeitado (top 5 da home)', async () => {
    charactersRepository.findRanking.mockResolvedValue(ok());
    await request(app).get('/api/v1/characters/ranking?period=week&limit=5');
    expect(charactersRepository.findRanking).toHaveBeenCalledWith(expect.objectContaining({ period: 'week', limit: 5 }));
  });

  it('período anterior devolve as datas do período', async () => {
    charactersRepository.findRanking.mockResolvedValue(ok({ periodStart: '2026-11-16', periodEnd: '2026-11-22' }));

    const res = await request(app).get('/api/v1/characters/ranking?period=week&previous=true');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ period: 'week', previous: true, periodStart: '2026-11-16', periodEnd: '2026-11-22' });
    expect(charactersRepository.findRanking).toHaveBeenCalledWith(expect.objectContaining({ period: 'week', previous: true }));
  });

  it('rejeita período desconhecido e previous no total', async () => {
    expect((await request(app).get('/api/v1/characters/ranking?period=year')).status).toBe(400);
    expect((await request(app).get('/api/v1/characters/ranking?period=total&previous=true')).status).toBe(400);
    expect(charactersRepository.findRanking).not.toHaveBeenCalled();
  });

  it('classCodes da mesma raça dividem a entrada de cache; raças e períodos diferentes não', async () => {
    charactersRepository.findRanking.mockResolvedValue(ok());

    await request(app).get('/api/v1/characters/ranking?classCode=16&period=month');
    await request(app).get('/api/v1/characters/ranking?classCode=19&period=month');
    expect(charactersRepository.findRanking).toHaveBeenCalledTimes(1);
    expect(charactersRepository.findRanking).toHaveBeenCalledWith(expect.objectContaining({ raceCode: 16 }));

    await request(app).get('/api/v1/characters/ranking?classCode=32&period=month');
    await request(app).get('/api/v1/characters/ranking?classCode=16&period=day');
    expect(charactersRepository.findRanking).toHaveBeenCalledTimes(3);
  });
});
