const { getPool, sql } = require('./pool');

async function create({ accountId, tokenHash, expiresAt, createdByIp, userAgent }) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('tokenHash', sql.Char(64), tokenHash)
    .input('expiresAt', sql.DateTime2, expiresAt)
    .input('createdByIp', sql.VarChar(45), createdByIp || null)
    .input('userAgent', sql.VarChar(255), userAgent || null)
    .query(`
      INSERT INTO WebRefreshTokens (AccountId, TokenHash, ExpiresAt, CreatedByIp, UserAgent)
      VALUES (@accountId, @tokenHash, @expiresAt, @createdByIp, @userAgent)
    `);
}

async function findByTokenHash(tokenHash) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('tokenHash', sql.Char(64), tokenHash)
    .query(`
      SELECT Id, AccountId, TokenHash, ExpiresAt, CreatedAt, RevokedAt, ReplacedByTokenHash
      FROM WebRefreshTokens
      WHERE TokenHash = @tokenHash
    `);
  return result.recordset[0] || null;
}

async function revokeByTokenHash(tokenHash, replacedByTokenHash) {
  const pool = getPool();
  await pool
    .request()
    .input('tokenHash', sql.Char(64), tokenHash)
    .input('replacedByTokenHash', sql.Char(64), replacedByTokenHash || null)
    .query(`
      UPDATE WebRefreshTokens
      SET RevokedAt = SYSUTCDATETIME(), ReplacedByTokenHash = @replacedByTokenHash
      WHERE TokenHash = @tokenHash AND RevokedAt IS NULL
    `);
}

async function revokeAllForAccount(accountId) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .query(`
      UPDATE WebRefreshTokens
      SET RevokedAt = SYSUTCDATETIME()
      WHERE AccountId = @accountId AND RevokedAt IS NULL
    `);
}

module.exports = { create, findByTokenHash, revokeByTokenHash, revokeAllForAccount };
