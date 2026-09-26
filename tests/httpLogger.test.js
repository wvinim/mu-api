const { Writable } = require('stream');
const express = require('express');
const pino = require('pino');
const request = require('supertest');
const { createHttpLogger } = require('../src/utils/httpLogger');

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
  return { app, lines };
}

test('não grava o Bearer token nem cookies no log', async () => {
  const { app, lines } = appWithCapturedLogs();
  await request(app).get('/api/v1/account/me').set('Authorization', 'Bearer eyJsegredo.jwt.token').set('Cookie', 'sid=abc');

  const log = lines.join('');
  expect(log).toContain('request completed');
  expect(log).not.toContain('eyJsegredo');
  expect(log).not.toContain('sid=abc');
  expect(JSON.parse(lines[0]).req.headers.authorization).toBe('[redacted]');
});

test('não grava o segredo do webhook (URL nem params)', async () => {
  const { app, lines } = appWithCapturedLogs();
  await request(app).post('/api/v1/shop/payment/webhook/cbc30c83segredo/pix').send({ pix: [] });

  const log = lines.join('');
  expect(log).not.toContain('cbc30c83segredo');
  expect(JSON.parse(lines[0]).req.url).toBe('/api/v1/shop/payment/webhook/[redacted]/pix');
});
