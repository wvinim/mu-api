const request = require('supertest');

// req.ip atrás do nginx: sem TRUST_PROXY todo mundo vira 127.0.0.1 (rate
// limit global); com TRUST_PROXY=1 vale o IP do X-Forwarded-For.
function loadApp(trustProxy) {
  let app;
  jest.isolateModules(() => {
    process.env.TRUST_PROXY = String(trustProxy);
    app = require('../src/app');
    app.get('/__ip', (req, res) => res.json({ ip: req.ip }));
    // A rota de teste precisa vir antes do notFound, mas depois do
    // expressInit (que é quem instala o getter req.ip).
    const stack = app._router.stack;
    const initAt = stack.findIndex((layer) => layer.name === 'expressInit');
    stack.splice(initAt + 1, 0, stack.pop());
  });
  return app;
}

afterEach(() => {
  delete process.env.TRUST_PROXY;
});

test('TRUST_PROXY=0 ignora X-Forwarded-For', async () => {
  const res = await request(loadApp(0)).get('/__ip').set('X-Forwarded-For', '203.0.113.7');
  expect(res.body.ip).not.toBe('203.0.113.7');
});

test('TRUST_PROXY=1 usa o IP real do cliente vindo do nginx', async () => {
  const res = await request(loadApp(1)).get('/__ip').set('X-Forwarded-For', '203.0.113.7');
  expect(res.body.ip).toBe('203.0.113.7');
});

test('TRUST_PROXY=1 confia só no último salto — IP forjado pelo cliente é ignorado', async () => {
  // nginx com $proxy_add_x_forwarded_for acrescenta o IP real ao que o cliente mandou.
  const res = await request(loadApp(1)).get('/__ip').set('X-Forwarded-For', '1.2.3.4, 203.0.113.7');
  expect(res.body.ip).toBe('203.0.113.7');
});
