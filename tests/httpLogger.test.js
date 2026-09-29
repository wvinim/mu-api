const { Writable } = require('stream');
const express = require('express');
const pino = require('pino');
const request = require('supertest');
const { createHttpLogger } = require('../src/utils/httpLogger');
const AppError = require('../src/utils/AppError');
const notFound = require('../src/middlewares/notFound');
const errorHandler = require('../src/middlewares/errorHandler');

function appWithCapturedLogs() {
  const lines = [];
  const stream = new Writable({
    write(chunk, enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const app = express();
  app.use(createHttpLogger(pino({ level: 'info' }, stream)));
  app.get('/api/v1/account/me', (req, res) => res.json({ ok: true }));
  app.post('/api/v1/shop/payment/webhook/:secret/pix', (req, res) => res.json({ received: true }));
  app.get('/api/v1/forbidden', (req, res, next) => next(new AppError(403, 'FORBIDDEN', 'Sem permissão.')));
  app.get('/api/v1/boom', () => {
    throw new Error('kaboom');
  });
  app.use(notFound);
  app.use(errorHandler);
  return { app, lines: () => lines.map((l) => JSON.parse(l)) };
}

test('não grava headers (Bearer token, cookies) no log', async () => {
  const { app, lines } = appWithCapturedLogs();
  await request(app).get('/api/v1/account/me').set('Authorization', 'Bearer eyJsegredo.jwt.token').set('Cookie', 'sid=abc');

  const log = JSON.stringify(lines());
  expect(log).toContain('request completed');
  expect(log).not.toContain('eyJsegredo');
  expect(log).not.toContain('sid=abc');
  expect(lines()[0].req.headers).toBeUndefined();
});

test('não grava o segredo do webhook (URL nem params)', async () => {
  const { app, lines } = appWithCapturedLogs();
  await request(app).post('/api/v1/shop/payment/webhook/cbc30c83segredo/pix').send({ pix: [] });

  expect(JSON.stringify(lines())).not.toContain('cbc30c83segredo');
  expect(lines()[0].req.url).toBe('/api/v1/shop/payment/webhook/[redacted]/pix');
});

test('linha enxuta: req só com id/method/url/ip/ua, res só com statusCode', async () => {
  const { app, lines } = appWithCapturedLogs();
  await request(app).get('/api/v1/account/me?x=1').set('User-Agent', 'teste/1.0');

  const [line] = lines();
  expect(Object.keys(line.req).sort()).toEqual(['id', 'ip', 'method', 'ua', 'url']);
  expect(line.req.url).toBe('/api/v1/account/me?x=1');
  expect(line.req.ua).toBe('teste/1.0');
  expect(line.res).toEqual({ statusCode: 200 });
});

test('404 gera uma única linha, em info, com errorCode', async () => {
  const { app, lines } = appWithCapturedLogs();
  await request(app).get('/.env').expect(404);

  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatchObject({ level: 30, errorCode: 'NOT_FOUND', res: { statusCode: 404 } });
});

test('outros 4xx saem em warn com errorCode', async () => {
  const { app, lines } = appWithCapturedLogs();
  await request(app).get('/api/v1/forbidden').expect(403);

  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatchObject({ level: 40, errorCode: 'FORBIDDEN' });
});

test('5xx gera uma única linha em error, com o stack do erro real', async () => {
  const { app, lines } = appWithCapturedLogs();
  await request(app).get('/api/v1/boom').expect(500);

  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatchObject({ level: 50, errorCode: 'INTERNAL_ERROR', err: { message: 'kaboom' } });
  expect(lines()[0].err.stack).toContain('kaboom');
});
