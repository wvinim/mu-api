process.env.INSTAGRAM_APP_SECRET = 'test-app-secret';
process.env.INSTAGRAM_VERIFY_TOKEN = 'test-verify-token';
process.env.INSTAGRAM_ACCESS_TOKEN = '';

const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');

const URL = '/api/v1/instagram/webhook';

function sign(body, secret = 'test-app-secret') {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

const payload = JSON.stringify({
  object: 'instagram',
  entry: [
    {
      id: '1789',
      time: 1700000000,
      messaging: [
        {
          sender: { id: '555' },
          recipient: { id: '1789' },
          timestamp: 1700000000,
          message: { mid: 'm1', attachments: [{ type: 'story_mention', payload: { url: 'https://cdn/x' } }] },
        },
      ],
    },
  ],
});

describe('GET /instagram/webhook (verificação)', () => {
  it('devolve hub.challenge com token correto', async () => {
    const res = await request(app)
      .get(URL)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '12345' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('12345');
  });

  it('recusa token errado', async () => {
    const res = await request(app)
      .get(URL)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '12345' });
    expect(res.status).toBe(403);
  });
});

describe('POST /instagram/webhook (assinatura)', () => {
  it('aceita assinatura válida', async () => {
    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(payload))
      .send(payload);
    expect(res.status).toBe(200);
  });

  it('recusa sem assinatura', async () => {
    const res = await request(app).post(URL).set('Content-Type', 'application/json').send(payload);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('recusa assinatura com segredo errado', async () => {
    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(payload, 'outro'))
      .send(payload);
    expect(res.status).toBe(401);
  });

  it('recusa corpo alterado depois de assinado', async () => {
    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(payload))
      .send(payload.replace('555', '666'));
    expect(res.status).toBe(401);
  });
});
