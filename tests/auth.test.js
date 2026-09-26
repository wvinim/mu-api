// Evita que os testes de login fiquem acoplados ao rate limit em memória
// (o limiter é compartilhado pelo processo inteiro do arquivo de teste).
process.env.RATE_LIMIT_LOGIN_MAX = '1000';

const request = require('supertest');
const bcrypt = require('bcrypt');

jest.mock('../src/db/accountsRepository');
jest.mock('../src/db/refreshTokensRepository');
jest.mock('../src/db/accountTokensRepository');
jest.mock('../src/db/auditLogRepository');

const app = require('../src/app');
const accountsRepository = require('../src/db/accountsRepository');
const refreshTokensRepository = require('../src/db/refreshTokensRepository');
const tokenService = require('../src/services/tokenService');
const { sha256Hex } = require('../src/utils/crypto');

function makeAccount(overrides = {}) {
  return {
    username: 'player1',
    displayName: 'player1',
    email: 'player1@example.com',
    emailConfirmed: true,
    banned: false,
    webPasswordHash: bcrypt.hashSync('senha123', 4),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/v1/auth/register', () => {
  it('rejeita username já existente com 409', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount());

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'player1', password: 'senha123', email: 'novo@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USERNAME_TAKEN');
    expect(accountsRepository.createAccount).not.toHaveBeenCalled();
  });

  it('rejeita e-mail já vinculado a outra conta com 409', async () => {
    accountsRepository.findByUsername.mockResolvedValue(null);
    accountsRepository.findAllByEmail.mockResolvedValue([makeAccount()]);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'novo123', password: 'senha123', email: 'player1@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(accountsRepository.createAccount).not.toHaveBeenCalled();
  });

  it('rejeita com 409 quando outro registro do mesmo e-mail vence a corrida', async () => {
    accountsRepository.findByUsername.mockResolvedValue(null);
    accountsRepository.findAllByEmail.mockResolvedValue([]);
    accountsRepository.createAccount.mockResolvedValue({ created: false });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'novo123', password: 'senha123', email: 'player1@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('cria a conta e grava as duas colunas de senha (texto puro + hash)', async () => {
    accountsRepository.findByUsername.mockResolvedValue(null);
    accountsRepository.findAllByEmail.mockResolvedValue([]);
    accountsRepository.createAccount.mockResolvedValue({ created: true });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'novo123', password: 'senha123', email: 'novo@example.com' });

    expect(res.status).toBe(201);
    expect(accountsRepository.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'novo123', plainPassword: 'senha123', email: 'novo@example.com' }),
    );
    const call = accountsRepository.createAccount.mock.calls[0][0];
    expect(call.passwordHash).not.toBe('senha123');
    await expect(bcrypt.compare('senha123', call.passwordHash)).resolves.toBe(true);
  });

  it('rejeita senha maior que 10 caracteres (limite da coluna memb__pwd)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'novo123', password: 'senhaMuitoGrande', email: 'novo@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('retorna 401 genérico quando a conta não existe', async () => {
    accountsRepository.findByUsername.mockResolvedValue(null);

    const res = await request(app).post('/api/v1/auth/login').send({ username: 'ghost', password: 'senha123' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('bloqueia login de conta banida', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount({ banned: true }));

    const res = await request(app).post('/api/v1/auth/login').send({ username: 'player1', password: 'senha123' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BANNED');
  });

  it('bloqueia login com senha errada', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount());

    const res = await request(app).post('/api/v1/auth/login').send({ username: 'player1', password: 'errada' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('bloqueia login de e-mail não confirmado', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount({ emailConfirmed: false }));

    const res = await request(app).post('/api/v1/auth/login').send({ username: 'player1', password: 'senha123' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_CONFIRMED');
  });

  it('faz login com sucesso e emite access+refresh token', async () => {
    accountsRepository.findByUsername.mockResolvedValue(makeAccount());
    refreshTokensRepository.create.mockResolvedValue();

    const res = await request(app).post('/api/v1/auth/login').send({ username: 'player1', password: 'senha123' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(refreshTokensRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'player1' }),
    );
  });
});

describe('POST /api/v1/auth/refresh-token', () => {
  it('rotaciona um refresh token válido (uso único)', async () => {
    const account = makeAccount();
    refreshTokensRepository.create.mockResolvedValue();
    const rawToken = await tokenService.issueRefreshToken(account);
    const tokenHash = sha256Hex(rawToken);

    refreshTokensRepository.findByTokenHash.mockResolvedValue({
      Id: 1,
      AccountId: account.username,
      TokenHash: tokenHash,
      RevokedAt: null,
    });
    accountsRepository.findByUsername.mockResolvedValue(account);
    refreshTokensRepository.revokeByTokenHash.mockResolvedValue();

    const res = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(rawToken);
    expect(refreshTokensRepository.revokeByTokenHash).toHaveBeenCalledWith(tokenHash, expect.any(String));
  });

  it('detecta reuso de refresh token já revogado e revoga toda a família', async () => {
    const account = makeAccount();
    refreshTokensRepository.create.mockResolvedValue();
    const rawToken = await tokenService.issueRefreshToken(account);
    const tokenHash = sha256Hex(rawToken);

    refreshTokensRepository.findByTokenHash.mockResolvedValue({
      Id: 1,
      AccountId: account.username,
      TokenHash: tokenHash,
      RevokedAt: new Date(),
    });
    refreshTokensRepository.revokeAllForAccount.mockResolvedValue();

    const res = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: rawToken });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    expect(refreshTokensRepository.revokeAllForAccount).toHaveBeenCalledWith(account.username);
  });

  it('rejeita um refresh token com assinatura inválida', async () => {
    const res = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: 'token.invalido.aqui' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });
});

describe('POST /api/v1/auth/change-password', () => {
  it('exige token de acesso', async () => {
    const res = await request(app).post('/api/v1/auth/change-password').send({ currentPassword: 'a', newPassword: 'b' });
    expect(res.status).toBe(401);
  });

  it('rejeita senha atual incorreta', async () => {
    const account = makeAccount();
    const accessToken = tokenService.issueAccessToken(account);
    accountsRepository.findByUsername.mockResolvedValue(account);

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'errada1', newPassword: 'novaSenha' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('troca a senha e invalida sessões ativas', async () => {
    const account = makeAccount();
    const accessToken = tokenService.issueAccessToken(account);
    accountsRepository.findByUsername.mockResolvedValue(account);
    accountsRepository.updatePasswordBoth.mockResolvedValue();
    refreshTokensRepository.revokeAllForAccount.mockResolvedValue();

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'senha123', newPassword: 'novaSenh' });

    expect(res.status).toBe(200);
    expect(accountsRepository.updatePasswordBoth).toHaveBeenCalledWith(
      account.username,
      expect.objectContaining({ plainPassword: 'novaSenh' }),
    );
    expect(refreshTokensRepository.revokeAllForAccount).toHaveBeenCalledWith(account.username);
  });
});
