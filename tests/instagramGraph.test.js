process.env.INSTAGRAM_ACCESS_TOKEN = 'tok';

jest.mock('../src/utils/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const logger = require('../src/utils/logger');
const graph = require('../src/services/instagramGraph');

function mockFetch({ status = 200, body = {}, headers = {} }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => jest.clearAllMocks());

describe('readUsage', () => {
  it('pega o maior percentual entre app e business use case', () => {
    const headers = new Headers({
      'x-app-usage': JSON.stringify({ call_count: 10, total_cputime: 5, total_time: 20 }),
      'x-business-use-case-usage': JSON.stringify({ 178: [{ type: 'instagram', call_count: 80, total_cputime: 1, total_time: 3 }] }),
    });
    expect(graph.readUsage(headers).max).toBe(80);
  });

  it('header ausente ou inválido → 0', () => {
    expect(graph.readUsage(new Headers({ 'x-app-usage': 'lixo' })).max).toBe(0);
    expect(graph.readUsage(new Headers()).max).toBe(0);
  });
});

describe('aviso de limite', () => {
  it('avisa no log a partir de 75%', async () => {
    mockFetch({ body: { username: 'a', follower_count: 1 }, headers: { 'x-app-usage': JSON.stringify({ call_count: 76 }) } });
    await graph.fetchProfile('1');
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ call: 'profile', usagePercent: 76 }), expect.any(String));
  });

  it('abaixo de 75% não avisa', async () => {
    mockFetch({ body: { username: 'a', follower_count: 1 }, headers: { 'x-app-usage': JSON.stringify({ call_count: 74 }) } });
    await graph.fetchProfile('1');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('erro de limite atingido é marcado e logado', async () => {
    mockFetch({ status: 400, body: { error: { code: 4, message: 'Application request limit reached' } } });
    await expect(graph.fetchProfile('1')).rejects.toMatchObject({ rateLimited: true, status: 400 });
    expect(logger.error).toHaveBeenCalled();
  });

  it('o envio também confere o uso', async () => {
    mockFetch({ headers: { 'x-business-use-case-usage': JSON.stringify({ 1: [{ call_count: 90 }] }) } });
    await graph.sendText('acc', '555', 'oi');
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ call: 'send', usagePercent: 90 }), expect.any(String));
  });

  it('nunca loga o token', async () => {
    mockFetch({ status: 400, body: { error: { code: 4 } }, headers: { 'x-app-usage': JSON.stringify({ call_count: 99 }) } });
    await graph.fetchProfile('1').catch(() => {});
    const logged = JSON.stringify([...logger.warn.mock.calls, ...logger.error.mock.calls]);
    expect(logged).not.toContain('tok');
  });
});
