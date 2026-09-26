const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const keyPath = path.join(os.tmpdir(), `dkim-test-${process.pid}.pem`);

beforeAll(() => fs.writeFileSync(keyPath, privateKey));
afterAll(() => fs.rmSync(keyPath, { force: true }));

function loadEmailService(dkim) {
  let createTransport;
  let emailService;
  jest.isolateModules(() => {
    jest.doMock('../src/config/env', () => ({
      appUrl: 'https://mupro.vip',
      emailTokenTtlHours: 24,
      passwordResetTokenTtlHours: 1,
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'noreply@mupro.vip',
        password: 'x',
        from: 'MU PRO <noreply@mupro.vip>',
        dkim,
      },
    }));
    const sendMail = jest.fn().mockResolvedValue({});
    createTransport = jest.fn(() => ({ sendMail }));
    jest.doMock('nodemailer', () => ({ createTransport }));
    emailService = require('../src/services/emailService');
  });
  return { emailService, createTransport };
}

describe('emailService — DKIM', () => {
  afterEach(() => jest.resetModules());

  test('sem variáveis DKIM, transporte é criado sem assinatura', async () => {
    const { emailService, createTransport } = loadEmailService({ domainName: '', keySelector: '', privateKeyPath: '' });
    await emailService.sendConfirmationEmail('a@b.com', 'tok');
    expect(createTransport.mock.calls[0][0].dkim).toBeUndefined();
  });

  test('com as três variáveis, passa domínio, seletor e conteúdo da chave', async () => {
    const { emailService, createTransport } = loadEmailService({ domainName: 'mupro.vip', keySelector: 'api', privateKeyPath: keyPath });
    await emailService.sendPasswordResetEmail('a@b.com', 'tok');
    expect(createTransport.mock.calls[0][0].dkim).toEqual({ domainName: 'mupro.vip', keySelector: 'api', privateKey });
  });

  test('configuração parcial falha em vez de enviar sem assinatura', async () => {
    const { emailService } = loadEmailService({ domainName: 'mupro.vip', keySelector: '', privateKeyPath: keyPath });
    await expect(emailService.sendConfirmationEmail('a@b.com', 'tok')).rejects.toThrow(/DKIM parcialmente configurado/);
  });

  test('caminho de chave inexistente falha', async () => {
    const { emailService } = loadEmailService({ domainName: 'mupro.vip', keySelector: 'api', privateKeyPath: path.join(os.tmpdir(), 'nao-existe.pem') });
    await expect(emailService.sendConfirmationEmail('a@b.com', 'tok')).rejects.toThrow(/ENOENT/);
  });
});

describe('nodemailer real — assinatura DKIM', () => {
  test('mensagem sai com DKIM-Signature d=mupro.vip; s=api', async () => {
    const nodemailer = jest.requireActual('nodemailer');
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      dkim: { domainName: 'mupro.vip', keySelector: 'api', privateKey },
    });
    const info = await transport.sendMail({ from: 'noreply@mupro.vip', to: 'a@b.com', subject: 'teste', html: '<p>oi</p>' });
    const raw = info.message.toString();
    expect(raw).toMatch(/^DKIM-Signature: /m);
    expect(raw).toMatch(/d=mupro\.vip;/);
    expect(raw).toMatch(/s=api;/);
  });
});
