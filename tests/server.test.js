const request = require('supertest');

jest.mock('../src/db/serverStatusRepository');

const app = require('../src/app');
const serverStatusRepository = require('../src/db/serverStatusRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/server/status', () => {
  it('retorna status online e a contagem de jogadores conectados, cacheando o resultado', async () => {
    serverStatusRepository.getOnlineCount.mockResolvedValue(42);

    const res1 = await request(app).get('/api/v1/server/status');
    const res2 = await request(app).get('/api/v1/server/status');

    expect(res1.status).toBe(200);
    expect(res1.body).toEqual({ status: 'online', playersOnline: 42 });
    expect(res2.body).toEqual(res1.body);
    // A segunda chamada deve vir do cache (SERVER_STATUS_CACHE_TTL_SECONDS).
    expect(serverStatusRepository.getOnlineCount).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/v1/server/info', () => {
  it('retorna os metadados estáticos configurados no .env', async () => {
    const res = await request(app).get('/api/v1/server/info');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('season');
    expect(res.body).toHaveProperty('websiteUrl');
  });
});
