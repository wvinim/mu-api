process.env.INSTAGRAM_APP_SECRET = 'test-app-secret';
process.env.INSTAGRAM_VERIFY_TOKEN = 'test-verify-token';
process.env.INSTAGRAM_ACCESS_TOKEN = 'test-token';
process.env.INSTAGRAM_CAMPAIGN_ENABLED = 'false';
process.env.INSTAGRAM_TESTERS = 'tester1';

const crypto = require('crypto');
const request = require('supertest');

jest.mock('../src/services/instagramCampaignService', () => {
  const actual = jest.requireActual('../src/services/instagramCampaignService');
  return {
    ...actual,
    handleWebhook: jest.fn(),
    createLinkCode: jest.fn(),
    getStatus: jest.fn(),
    unlink: jest.fn(),
  };
});
jest.mock('../src/db/auditLogRepository');

const app = require('../src/app');
const campaign = require('../src/services/instagramCampaignService');
const tokenService = require('../src/services/tokenService');

const URL = '/api/v1/instagram/webhook';

function sign(body, secret = 'test-app-secret') {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

function authHeader(username) {
  return `Bearer ${tokenService.issueAccessToken({ username })}`;
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

beforeEach(() => {
  jest.clearAllMocks();
  campaign.handleWebhook.mockResolvedValue();
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
  it('aceita assinatura válida e processa o corpo', async () => {
    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(payload))
      .send(payload);
    expect(res.status).toBe(200);
    expect(campaign.handleWebhook).toHaveBeenCalledWith(JSON.parse(payload));
  });

  it('recusa sem assinatura e não processa', async () => {
    const res = await request(app).post(URL).set('Content-Type', 'application/json').send(payload);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect(campaign.handleWebhook).not.toHaveBeenCalled();
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

  it('responde 500 quando o processamento falha (a Meta reenvia)', async () => {
    campaign.handleWebhook.mockRejectedValue(new Error('db down'));
    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(payload))
      .send(payload);
    expect(res.status).toBe(500);
  });
});

describe('GET /instagram/campaign (pública)', () => {
  it('devolve os valores da campanha sem login', async () => {
    const res = await request(app).get('/api/v1/instagram/campaign');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: false,
      instagramHandle: 'muproserver',
      rewardCash: 40,
      minFollowers: 50,
      retroactiveDays: 7,
    });
  });
});

describe('rotas da conta', () => {
  it('exigem login', async () => {
    expect((await request(app).get('/api/v1/account/instagram')).status).toBe(401);
    expect((await request(app).post('/api/v1/account/instagram/link-code')).status).toBe(401);
  });

  it('GET /account/instagram devolve o status do serviço', async () => {
    campaign.getStatus.mockResolvedValue({ campaignEnabled: false, link: null });
    const res = await request(app).get('/api/v1/account/instagram').set('Authorization', authHeader('player1'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ campaignEnabled: false, link: null });
    expect(campaign.getStatus).toHaveBeenCalledWith('player1');
  });

  it('link-code: 403 com campanha desligada para quem não é tester', async () => {
    const res = await request(app)
      .post('/api/v1/account/instagram/link-code')
      .set('Authorization', authHeader('player1'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CAMPAIGN_DISABLED');
    expect(campaign.createLinkCode).not.toHaveBeenCalled();
  });

  it('link-code: tester recebe código', async () => {
    campaign.createLinkCode.mockResolvedValue({ code: 'MUPRO-ABCDEF', expiresAt: '2026-11-25T12:30:00Z', instagramHandle: 'muproserver' });
    const res = await request(app)
      .post('/api/v1/account/instagram/link-code')
      .set('Authorization', authHeader('tester1'));
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('MUPRO-ABCDEF');
  });

  it('DELETE: 404 sem vínculo, 200 com vínculo', async () => {
    campaign.unlink.mockResolvedValueOnce(null);
    let res = await request(app).delete('/api/v1/account/instagram').set('Authorization', authHeader('player1'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INSTAGRAM_NOT_LINKED');

    campaign.unlink.mockResolvedValueOnce({ igsid: '555', igUsername: 'fulano' });
    res = await request(app).delete('/api/v1/account/instagram').set('Authorization', authHeader('player1'));
    expect(res.status).toBe(200);
  });
});
