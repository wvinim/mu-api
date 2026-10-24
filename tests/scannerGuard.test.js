const express = require('express');
const request = require('supertest');
const { createScannerGuard, PROBE_PATH } = require('../src/middlewares/scannerGuard');

// App mínimo: o IP vem do X-Forwarded-For (trust proxy) para simular
// clientes distintos atrás do nginx.
function buildApp(options = {}) {
  let t = 0;
  const log = { warn: jest.fn() };
  const guard = createScannerGuard({
    maxStrikes: 3,
    windowMinutes: 10,
    banMinutes: 60,
    now: () => t,
    log,
    ...options,
  });
  const app = express();
  app.set('trust proxy', 1);
  app.use(guard.middleware);
  app.get('/api/v1/ok', (req, res) => res.json({ ok: true }));
  app.get('/api/v1/characters/:name', (req, res) => res.status(404).json({ error: { code: 'CHARACTER_NOT_FOUND' } }));
  app.use((req, res) => {
    guard.addStrike(req);
    res.status(404).json({ error: { code: 'NOT_FOUND' } });
  });
  return { app, guard, log, advance: (ms) => { t += ms; } };
}

const get = (app, path, ip = '203.0.113.7') => request(app).get(path).set('X-Forwarded-For', ip);

test('caminho de exploit bloqueia o IP na hora, inclusive nas rotas válidas', async () => {
  const { app, log } = buildApp();
  const res = await get(app, '/.env');
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('IP_BLOCKED');
  expect((await get(app, '/api/v1/ok')).status).toBe(403);
  expect((await get(app, '/api/v1/ok', '198.51.100.1')).status).toBe(200);
  expect(log.warn).toHaveBeenCalledTimes(1);
});

test('rotas inexistentes acumulam strikes até bloquear', async () => {
  const { app } = buildApp();
  await get(app, '/foo');
  await get(app, '/bar');
  expect((await get(app, '/api/v1/ok')).status).toBe(200);
  expect((await get(app, '/baz')).status).toBe(404); // 3º strike bloqueia
  expect((await get(app, '/api/v1/ok')).status).toBe(403);
});

test('404 legítimo de controller não conta strike', async () => {
  const { app } = buildApp();
  for (let i = 0; i < 5; i += 1) await get(app, `/api/v1/characters/nope${i}`);
  expect((await get(app, '/api/v1/ok')).status).toBe(200);
});

test('strikes expiram com a janela e o bloqueio expira com banMinutes', async () => {
  const { app, advance } = buildApp();
  await get(app, '/a');
  await get(app, '/b');
  advance(11 * 60 * 1000);
  await get(app, '/c');
  expect((await get(app, '/api/v1/ok')).status).toBe(200);

  await get(app, '/wp-login.php');
  expect((await get(app, '/api/v1/ok')).status).toBe(403);
  advance(61 * 60 * 1000);
  expect((await get(app, '/api/v1/ok')).status).toBe(200);
});

test('loopback e allowlist nunca são bloqueados; enabled=false desliga', async () => {
  const { app } = buildApp({ allowlist: ['198.51.100.9'] });
  expect((await get(app, '/.env', '127.0.0.1')).status).toBe(404);
  expect((await get(app, '/.env', '198.51.100.9')).status).toBe(404);
  const off = buildApp({ enabled: false });
  expect((await get(off.app, '/.git/config')).status).toBe(404);
});

test('PROBE_PATH pega varreduras comuns e não pega rotas reais da API', () => {
  const probes = [
    '/.env', '/api/.env', '/.git/config', '/wp-admin/', '/wp-login.php', '/index.php',
    '/phpmyadmin/', '/vendor/phpunit/src/Util/PHP/eval-stdin.php', '/cgi-bin/luci',
    '/actuator/health', '/backup.sql', '/config.bak', '/xmlrpc.php', '/boaform/admin/formLogin',
  ];
  for (const p of probes) expect(PROBE_PATH.test(p)).toBe(true);

  const app = require('../src/app');
  const real = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) real.push(prefix + layer.route.path);
      else if (layer.handle && layer.handle.stack) walk(layer.handle.stack, prefix);
    }
  };
  walk(app._router.stack, '/api/v1');
  expect(real.length).toBeGreaterThan(20);
  for (const p of real) expect(PROBE_PATH.test(p)).toBe(false);
});
