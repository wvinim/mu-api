const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const ms = require('ms');

const env = require('../config/env');
const AppError = require('../utils/AppError');
const { generateOpaqueToken, sha256Hex } = require('../utils/crypto');
const { getRole } = require('./roleService');
const refreshTokensRepository = require('../db/refreshTokensRepository');
const accountTokensRepository = require('../db/accountTokensRepository');
const accountsRepository = require('../db/accountsRepository');

function issueAccessToken(account) {
  return jwt.sign(
    { sub: account.username, role: getRole(account.username), type: 'access' },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiresIn },
  );
}

/**
 * Refresh token: JWT assinado (conforme decisão de stack), mas com o hash
 * também guardado em WebRefreshTokens — isso permite revogação e rotação
 * de uso único, que um JWT puro (stateless) não permitiria.
 *
 * Decisão: rotativo (uso único). A cada /auth/refresh-token, o token usado
 * é revogado e um novo é emitido. Justificativa: se um refresh token
 * vazar, o uso único limita a janela de abuso a uma única troca — o dono
 * legítimo vai tentar usar o token antigo mais cedo ou mais tarde, o que
 * podemos detectar (token já revogado) e tratar como sinal de possível
 * roubo, revogando toda a família de tokens da conta.
 */
async function issueRefreshToken(account, { ip, userAgent } = {}) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: account.username, jti, type: 'refresh' },
    env.jwt.refreshSecret,
    { expiresIn: env.jwt.refreshExpiresIn },
  );
  const expiresAt = new Date(Date.now() + ms(env.jwt.refreshExpiresIn));
  await refreshTokensRepository.create({
    accountId: account.username,
    tokenHash: sha256Hex(token),
    expiresAt,
    createdByIp: ip,
    userAgent,
  });
  return token;
}

async function rotateRefreshToken(rawToken, { ip, userAgent } = {}) {
  let payload;
  try {
    payload = jwt.verify(rawToken, env.jwt.refreshSecret);
  } catch {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token inválido ou expirado.');
  }
  if (payload.type !== 'refresh') {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token inválido.');
  }

  const tokenHash = sha256Hex(rawToken);
  const row = await refreshTokensRepository.findByTokenHash(tokenHash);
  if (!row) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token inválido.');
  }
  if (row.RevokedAt) {
    // Reuso de um token já rotacionado/revogado: possível token roubado.
    // Revoga toda a família de tokens da conta por segurança.
    await refreshTokensRepository.revokeAllForAccount(row.AccountId);
    throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token já utilizado. Todas as sessões foram encerradas por segurança.');
  }

  const account = await accountsRepository.findByUsername(row.AccountId);
  if (!account || account.banned) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token inválido.');
  }

  const newRefreshToken = await issueRefreshToken(account, { ip, userAgent });
  await refreshTokensRepository.revokeByTokenHash(tokenHash, sha256Hex(newRefreshToken));

  return {
    account,
    accessToken: issueAccessToken(account),
    refreshToken: newRefreshToken,
  };
}

async function revokeRefreshToken(rawToken) {
  await refreshTokensRepository.revokeByTokenHash(sha256Hex(rawToken));
}

async function revokeAllRefreshTokensForAccount(username) {
  await refreshTokensRepository.revokeAllForAccount(username);
}

async function createAccountToken(accountId, purpose, ttlHours) {
  await accountTokensRepository.invalidatePending(accountId, purpose);
  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await accountTokensRepository.create({
    accountId,
    purpose,
    tokenHash: sha256Hex(rawToken),
    expiresAt,
  });
  return rawToken;
}

async function consumeAccountToken(rawToken, purpose) {
  const row = await accountTokensRepository.findValidByHash(sha256Hex(rawToken), purpose);
  if (!row) {
    throw new AppError(400, 'INVALID_TOKEN', 'Token inválido ou expirado.');
  }
  await accountTokensRepository.markUsed(row.Id);
  return row.AccountId;
}

module.exports = {
  issueAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForAccount,
  createAccountToken,
  consumeAccountToken,
};
