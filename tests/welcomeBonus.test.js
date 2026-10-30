// Bônus de boas-vindas no POST /auth/confirm-email: Mega Vip por 3 dias, sem
// Cash, só quando a confirmação de fato aconteceu (conta pendente → confirmada).

const request = require('supertest');

jest.mock('../src/db/accountsRepository');
jest.mock('../src/db/accountTokensRepository');
jest.mock('../src/db/auditLogRepository');

const app = require('../src/app');
const accountsRepository = require('../src/db/accountsRepository');
const accountTokensRepository = require('../src/db/accountTokensRepository');
const auditLog = require('../src/db/auditLogRepository');

beforeEach(() => {
  jest.clearAllMocks();
  accountTokensRepository.findValidByHash.mockResolvedValue({ Id: 1, AccountId: 'player1' });
});

describe('POST /api/v1/auth/confirm-email com bônus de boas-vindas', () => {
  test('concede Mega Vip por 3 dias, sem Cash, e audita', async () => {
    const vipEndDate = new Date('2026-11-02T12:00:00-03:00');
    accountsRepository.setEmailConfirmed.mockResolvedValue({ confirmed: true, cash: 0, vip: 3, vipEndDate });

    const res = await request(app).post('/api/v1/auth/confirm-email').send({ token: 'a'.repeat(64) });

    expect(res.status).toBe(200);
    expect(accountsRepository.setEmailConfirmed).toHaveBeenCalledWith('player1', { cash: 0, vipTier: 3, vipDays: 3 });
    expect(res.body.betaBonus).toEqual({ cash: 0, vipTier: 3, vipEndDate: vipEndDate.toISOString() });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'account.welcome_bonus', details: { cash: 0, vipTier: 3, vipDays: 3 } }),
    );
  });

  test('conta já confirmada não recebe o bônus de novo', async () => {
    accountsRepository.setEmailConfirmed.mockResolvedValue({ confirmed: false });

    const res = await request(app).post('/api/v1/auth/confirm-email').send({ token: 'a'.repeat(64) });

    expect(res.status).toBe(200);
    expect(res.body.betaBonus).toBeNull();
    expect(auditLog.record).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'account.welcome_bonus' }));
  });
});
