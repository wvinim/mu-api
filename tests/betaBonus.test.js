// Bônus do beta aberto: janela de datas (betaBonus.current) e concessão no
// POST /auth/confirm-email, que só credita quando a confirmação de fato
// aconteceu (conta pendente → confirmada).

const request = require('supertest');

jest.mock('../src/db/accountsRepository');
jest.mock('../src/db/accountTokensRepository');
jest.mock('../src/db/auditLogRepository');

const app = require('../src/app');
const env = require('../src/config/env');
const betaBonus = require('../src/services/betaBonus');
const accountsRepository = require('../src/db/accountsRepository');
const accountTokensRepository = require('../src/db/accountTokensRepository');
const auditLog = require('../src/db/auditLogRepository');

const originalConfig = { ...env.betaBonus };
const ENDS_AT = new Date('2026-10-30T00:00:00-03:00');

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(env.betaBonus, { endsAt: ENDS_AT, cash: 500, vipTier: 3, vipDays: 30 });
  accountTokensRepository.findValidByHash.mockResolvedValue({ Id: 1, AccountId: 'player1' });
});

afterAll(() => {
  Object.assign(env.betaBonus, originalConfig);
});

describe('betaBonus.current', () => {
  test('concede antes da data de fim', () => {
    expect(betaBonus.current(new Date('2026-10-29T23:59:59-03:00'))).toEqual({ cash: 500, vipTier: 3, vipDays: 30 });
  });

  test('desliga a partir da data de fim', () => {
    expect(betaBonus.current(ENDS_AT)).toBeNull();
    expect(betaBonus.current(new Date('2026-11-01T00:00:00-03:00'))).toBeNull();
  });

  test('desligado sem BETA_BONUS_ENDS_AT', () => {
    env.betaBonus.endsAt = null;
    expect(betaBonus.current(new Date('2026-10-01T00:00:00Z'))).toBeNull();
  });

  test('VIP sem dias não é concedido, só o Cash', () => {
    env.betaBonus.vipDays = 0;
    expect(betaBonus.current(new Date('2026-10-25T00:00:00Z'))).toEqual({ cash: 500, vipTier: 0, vipDays: 0 });
  });
});

describe('POST /api/v1/auth/confirm-email com bônus do beta', () => {
  const now = new Date('2026-10-25T12:00:00-03:00');

  beforeEach(() => {
    jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('concede Cash + Mega Vip na confirmação e audita', async () => {
    const vipEndDate = new Date('2026-11-24T12:00:00-03:00');
    accountsRepository.setEmailConfirmed.mockResolvedValue({ confirmed: true, cash: 500, vip: 3, vipEndDate });

    const res = await request(app).post('/api/v1/auth/confirm-email').send({ token: 'a'.repeat(64) });

    expect(res.status).toBe(200);
    expect(accountsRepository.setEmailConfirmed).toHaveBeenCalledWith('player1', { cash: 500, vipTier: 3, vipDays: 30 });
    expect(res.body.betaBonus).toEqual({ cash: 500, vipTier: 3, vipEndDate: vipEndDate.toISOString() });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'account.beta_bonus', details: { cash: 500, vipTier: 3, vipDays: 30 } }),
    );
  });

  test('conta já confirmada não recebe o bônus de novo', async () => {
    accountsRepository.setEmailConfirmed.mockResolvedValue({ confirmed: false });

    const res = await request(app).post('/api/v1/auth/confirm-email').send({ token: 'a'.repeat(64) });

    expect(res.status).toBe(200);
    expect(res.body.betaBonus).toBeNull();
    expect(auditLog.record).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'account.beta_bonus' }));
  });

  test('depois do fim do beta confirma sem bônus', async () => {
    jest.setSystemTime(ENDS_AT);
    accountsRepository.setEmailConfirmed.mockResolvedValue({ confirmed: true, cash: 0, vip: 0, vipEndDate: null });

    const res = await request(app).post('/api/v1/auth/confirm-email').send({ token: 'a'.repeat(64) });

    expect(res.status).toBe(200);
    expect(accountsRepository.setEmailConfirmed).toHaveBeenCalledWith('player1', null);
    expect(res.body.betaBonus).toBeNull();
  });
});
