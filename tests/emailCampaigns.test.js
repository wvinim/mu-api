process.env.ADMIN_USERNAMES = 'adminuser';
process.env.API_PUBLIC_URL = 'https://api.mupro.vip';
process.env.APP_URL = 'https://mupro.vip';
process.env.EMAIL_CAMPAIGN_DELAY_MS = '0';
process.env.EMAIL_CAMPAIGN_MAX_CONSECUTIVE_FAILURES = '2';

const request = require('supertest');

jest.mock('../src/db/accountsRepository');
jest.mock('../src/db/auditLogRepository');
jest.mock('../src/db/emailCampaignsRepository');
jest.mock('../src/services/emailService');

const app = require('../src/app');
const accountsRepository = require('../src/db/accountsRepository');
const emailCampaignsRepository = require('../src/db/emailCampaignsRepository');
const emailService = require('../src/services/emailService');
const emailCampaignService = require('../src/services/emailCampaignService');
const tokenService = require('../src/services/tokenService');

function authHeader(username) {
  return `Bearer ${tokenService.issueAccessToken({ username })}`;
}

// Espera o job em segundo plano terminar (delay 0 entre e-mails).
async function waitForJob(key, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (emailCampaignService._jobs.get(key)?.status !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('job não terminou');
}

function unsubscribeQuery(email) {
  return new URL(emailCampaignService.buildUnsubscribeUrl(email)).search;
}

beforeEach(() => {
  jest.clearAllMocks();
  emailCampaignService._jobs.clear();
  emailService.isSmtpConfigured.mockReturnValue(true);
  emailService.sendCampaignEmail.mockResolvedValue();
  emailCampaignsRepository.findRecipientAccounts.mockResolvedValue([]);
  emailCampaignsRepository.findSentEmails.mockResolvedValue([]);
  emailCampaignsRepository.findUnsubscribedEmails.mockResolvedValue([]);
  emailCampaignsRepository.countByStatus.mockResolvedValue({ sent: 0, failed: 0 });
  emailCampaignsRepository.recordSend.mockResolvedValue();
  emailCampaignsRepository.addUnsubscribe.mockResolvedValue();
});

describe('autorização em /admin/email-campaigns', () => {
  it('jogador comum recebe 403', async () => {
    const res = await request(app).post('/api/v1/admin/email-campaigns/inauguracao/send').set('Authorization', authHeader('player1'));
    expect(res.status).toBe(403);
    expect(emailService.sendCampaignEmail).not.toHaveBeenCalled();
  });

  it('campanha inexistente dá 404', async () => {
    const res = await request(app).get('/api/v1/admin/email-campaigns/nao-existe').set('Authorization', authHeader('adminuser'));
    expect(res.status).toBe(404);
  });
});

describe('destinatários pendentes', () => {
  it('um envio por e-mail, sem descadastrados nem quem já recebeu', async () => {
    emailCampaignsRepository.findRecipientAccounts.mockResolvedValue([
      { username: 'a1', displayName: 'Alfa', email: 'Alfa@X.com ' },
      { username: 'a2', displayName: '', email: 'alfa@x.com' }, // mesmo e-mail de a1
      { username: 'b1', displayName: '  ', email: 'b@x.com' },
      { username: 'c1', displayName: 'C', email: 'c@x.com' }, // já recebeu
      { username: 'd1', displayName: 'D', email: 'D@x.com' }, // descadastrado
      { username: 'e1', displayName: 'E', email: 'sem-arroba' },
    ]);
    emailCampaignsRepository.findSentEmails.mockResolvedValue(['c@x.com']);
    emailCampaignsRepository.findUnsubscribedEmails.mockResolvedValue(['d@x.com']);

    const recipients = await emailCampaignService.findPendingRecipients('inauguracao');

    expect(recipients).toEqual([
      { email: 'alfa@x.com', accountId: 'a1', name: 'Alfa' },
      { email: 'b@x.com', accountId: 'b1', name: 'b1' },
    ]);
  });
});

describe('POST /admin/email-campaigns/:key/test', () => {
  it('sem `to`, envia para o e-mail do admin com [TESTE] no assunto e não grava envio', async () => {
    accountsRepository.findByUsername.mockResolvedValue({ username: 'adminuser', displayName: 'Admin', email: 'admin@x.com' });

    const res = await request(app)
      .post('/api/v1/admin/email-campaigns/inauguracao/test')
      .set('Authorization', authHeader('adminuser'))
      .send({});

    expect(res.status).toBe(200);
    const [to, message] = emailService.sendCampaignEmail.mock.calls[0];
    expect(to).toBe('admin@x.com');
    expect(message.subject).toMatch(/^\[TESTE\] /);
    expect(message.html).toContain('Olá, Admin!');
    expect(message.unsubscribeUrl).toMatch(/^https:\/\/api\.mupro\.vip\/api\/v1\/email\/unsubscribe\?email=admin%40x\.com&token=/);
    expect(emailCampaignsRepository.recordSend).not.toHaveBeenCalled();
  });

  it('escapa HTML no nome', async () => {
    accountsRepository.findByUsername.mockResolvedValue({ username: 'adminuser', displayName: '<b>x</b>', email: 'admin@x.com' });

    await request(app)
      .post('/api/v1/admin/email-campaigns/inauguracao/test')
      .set('Authorization', authHeader('adminuser'))
      .send({});

    expect(emailService.sendCampaignEmail.mock.calls[0][1].html).toContain('Olá, &lt;b&gt;x&lt;/b&gt;!');
  });

  it('sem SMTP configurado dá 503 em vez de fingir que enviou', async () => {
    emailService.isSmtpConfigured.mockReturnValue(false);
    accountsRepository.findByUsername.mockResolvedValue({ username: 'adminuser', email: 'admin@x.com' });

    const res = await request(app)
      .post('/api/v1/admin/email-campaigns/inauguracao/test')
      .set('Authorization', authHeader('adminuser'))
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SMTP_NOT_CONFIGURED');
  });
});

describe('POST /admin/email-campaigns/:key/send', () => {
  it('responde 202 e envia em segundo plano, gravando cada envio', async () => {
    emailCampaignsRepository.findRecipientAccounts.mockResolvedValue([
      { username: 'a1', displayName: 'Alfa', email: 'a@x.com' },
      { username: 'b1', displayName: 'Beta', email: 'b@x.com' },
    ]);

    const res = await request(app).post('/api/v1/admin/email-campaigns/inauguracao/send').set('Authorization', authHeader('adminuser'));

    expect(res.status).toBe(202);
    expect(res.body.job).toEqual(expect.objectContaining({ status: 'running', total: 2, startedBy: 'adminuser' }));

    await waitForJob('inauguracao');
    expect(emailService.sendCampaignEmail).toHaveBeenCalledTimes(2);
    expect(emailCampaignsRepository.recordSend).toHaveBeenCalledWith(
      expect.objectContaining({ campaignKey: 'inauguracao', email: 'a@x.com', accountId: 'a1', status: 'sent' }),
    );
    expect(emailCampaignService._jobs.get('inauguracao')).toEqual(expect.objectContaining({ status: 'finished', sent: 2, failed: 0 }));
  });

  it('409 se a campanha já está enviando', async () => {
    emailCampaignService._jobs.set('inauguracao', { status: 'running' });

    const res = await request(app).post('/api/v1/admin/email-campaigns/inauguracao/send').set('Authorization', authHeader('adminuser'));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CAMPAIGN_ALREADY_RUNNING');
  });

  it('grava a falha e para após N falhas seguidas', async () => {
    emailCampaignsRepository.findRecipientAccounts.mockResolvedValue([
      { username: 'a1', email: 'a@x.com' },
      { username: 'b1', email: 'b@x.com' },
      { username: 'c1', email: 'c@x.com' },
    ]);
    emailService.sendCampaignEmail.mockRejectedValue(new Error('550 limite'));

    await request(app).post('/api/v1/admin/email-campaigns/inauguracao/send').set('Authorization', authHeader('adminuser'));
    await waitForJob('inauguracao');

    expect(emailService.sendCampaignEmail).toHaveBeenCalledTimes(2);
    expect(emailCampaignsRepository.recordSend).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@x.com', status: 'failed', error: '550 limite' }),
    );
    expect(emailCampaignService._jobs.get('inauguracao')).toEqual(expect.objectContaining({ status: 'aborted', failed: 2 }));
  });
});

describe('/email/unsubscribe', () => {
  it('GET com token válido só mostra a confirmação, sem descadastrar', async () => {
    const res = await request(app).get(`/api/v1/email/unsubscribe${unsubscribeQuery('Jogador@X.com')}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Confirmar descadastro');
    expect(emailCampaignsRepository.addUnsubscribe).not.toHaveBeenCalled();
  });

  it('POST com token válido descadastra (e-mail em minúsculo)', async () => {
    const res = await request(app)
      .post(`/api/v1/email/unsubscribe${unsubscribeQuery('Jogador@X.com')}`)
      .type('form')
      .send('List-Unsubscribe=One-Click');

    expect(res.status).toBe(200);
    expect(emailCampaignsRepository.addUnsubscribe).toHaveBeenCalledWith('jogador@x.com');
  });

  it('token de outro e-mail é recusado', async () => {
    const token = new URLSearchParams(unsubscribeQuery('a@x.com')).get('token');

    const res = await request(app).post(`/api/v1/email/unsubscribe?email=b%40x.com&token=${encodeURIComponent(token)}`);

    expect(res.status).toBe(400);
    expect(emailCampaignsRepository.addUnsubscribe).not.toHaveBeenCalled();
  });
});
