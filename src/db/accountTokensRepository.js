const { getPool, sql } = require('./pool');

async function create({ accountId, purpose, tokenHash, expiresAt, createdByIp }) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('purpose', sql.VarChar(20), purpose)
    .input('tokenHash', sql.Char(64), tokenHash)
    .input('expiresAt', sql.DateTime2, expiresAt)
    .input('createdByIp', sql.VarChar(45), createdByIp || null)
    .query(`
      INSERT INTO WebAccountTokens (AccountId, Purpose, TokenHash, ExpiresAt, CreatedByIp)
      VALUES (@accountId, @purpose, @tokenHash, @expiresAt, @createdByIp)
    `);
}

async function findValidByHash(tokenHash, purpose) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('tokenHash', sql.Char(64), tokenHash)
    .input('purpose', sql.VarChar(20), purpose)
    .query(`
      SELECT Id, AccountId, Purpose, ExpiresAt, UsedAt
      FROM WebAccountTokens
      WHERE TokenHash = @tokenHash AND Purpose = @purpose
        AND UsedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()
    `);
  return result.recordset[0] || null;
}

async function markUsed(id) {
  const pool = getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .query('UPDATE WebAccountTokens SET UsedAt = SYSUTCDATETIME() WHERE Id = @id');
}

/** Invalida tokens anteriores não usados da mesma finalidade (ex: ao reenviar confirmação). */
async function invalidatePending(accountId, purpose) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('purpose', sql.VarChar(20), purpose)
    .query(`
      UPDATE WebAccountTokens
      SET UsedAt = SYSUTCDATETIME()
      WHERE AccountId = @accountId AND Purpose = @purpose AND UsedAt IS NULL
    `);
}

module.exports = { create, findValidByHash, markUsed, invalidatePending };
