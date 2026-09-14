const request = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  it('responde 200 com status ok, sem depender do banco', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('rota inexistente', () => {
  it('responde 404 no formato de erro padronizado', async () => {
    const res = await request(app).get('/api/v1/rota-que-nao-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
      },
    });
  });
});
