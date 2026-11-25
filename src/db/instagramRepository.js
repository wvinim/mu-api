const { getPool, sql } = require('./pool');

/**
 * Campanha de story no Instagram (migration 0018, docs/SECTION_15_INSTAGRAM.md).
 * IGSID = ID da pessoa no nosso perfil do Instagram (chega no webhook).
 * Sem JOIN com MEMB_INFO (collation — docs/DB_NOTES.md).
 */

const UNIQUE_VIOLATION = new Set([2627, 2601]);

function isUniqueViolation(err) {
  return Boolean(err && UNIQUE_VIOLATION.has(err.number));
}

/**
 * Novo código de vínculo para a conta. Apaga os códigos ainda não usados
 * da conta (um ativo por vez). Lança erro de UNIQUE se o código colidir;
 * quem chama gera outro.
 */
async function createLinkCode(username, code, ttlMinutes) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .input('code', sql.VarChar(16), code)
    .input('ttlMinutes', sql.Int, ttlMinutes)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DELETE FROM WebInstagramLinkCodes WHERE Username = @username AND UsedAt IS NULL;
      INSERT INTO WebInstagramLinkCodes (Code, Username, ExpiresAt)
      VALUES (@code, @username, DATEADD(minute, @ttlMinutes, SYSUTCDATETIME()));
      COMMIT TRANSACTION;
      SELECT ExpiresAt AS expiresAt FROM WebInstagramLinkCodes WHERE Code = @code;
    `);
  return result.recordset[0].expiresAt;
}

/**
 * Usa o código recebido no Direct e grava o vínculo, tudo numa transação.
 * Resultado: 'linked' | 'already_linked' (mesmo Direct reenviado) |
 * 'invalid' | 'expired' | 'igsid_taken' (Instagram vinculado a outra conta).
 */
async function consumeLinkCode(code, igsid, igUsername) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('code', sql.VarChar(16), code)
    .input('igsid', sql.VarChar(32), igsid)
    .input('igUsername', sql.VarChar(64), igUsername || null)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      DECLARE @username VARCHAR(10), @usedAt DATETIME2, @usedBy VARCHAR(32), @expiresAt DATETIME2;
      SELECT @username = Username, @usedAt = UsedAt, @usedBy = UsedByIgsid, @expiresAt = ExpiresAt
      FROM WebInstagramLinkCodes WITH (UPDLOCK, HOLDLOCK)
      WHERE Code = @code;

      IF @username IS NULL
      BEGIN
        ROLLBACK TRANSACTION;
        SELECT 'invalid' AS result, CAST(NULL AS VARCHAR(10)) AS username;
        RETURN;
      END

      IF @usedAt IS NOT NULL
      BEGIN
        ROLLBACK TRANSACTION;
        SELECT CASE WHEN @usedBy = @igsid THEN 'already_linked' ELSE 'invalid' END AS result,
               CASE WHEN @usedBy = @igsid THEN @username END AS username;
        RETURN;
      END

      IF @expiresAt < SYSUTCDATETIME()
      BEGIN
        ROLLBACK TRANSACTION;
        SELECT 'expired' AS result, CAST(NULL AS VARCHAR(10)) AS username;
        RETURN;
      END

      DECLARE @owner VARCHAR(10);
      SELECT @owner = Username FROM WebInstagramLinks WITH (UPDLOCK, HOLDLOCK) WHERE Igsid = @igsid;

      IF @owner IS NOT NULL AND @owner <> @username
      BEGIN
        ROLLBACK TRANSACTION;
        SELECT 'igsid_taken' AS result, CAST(NULL AS VARCHAR(10)) AS username;
        RETURN;
      END

      IF EXISTS (SELECT 1 FROM WebInstagramLinks WITH (UPDLOCK, HOLDLOCK) WHERE Username = @username)
        UPDATE WebInstagramLinks
        SET Igsid = @igsid, IgUsername = @igUsername, LinkedAt = SYSUTCDATETIME()
        WHERE Username = @username;
      ELSE
        INSERT INTO WebInstagramLinks (Username, Igsid, IgUsername) VALUES (@username, @igsid, @igUsername);

      UPDATE WebInstagramLinkCodes SET UsedAt = SYSUTCDATETIME(), UsedByIgsid = @igsid WHERE Code = @code;

      COMMIT TRANSACTION;
      SELECT 'linked' AS result, @username AS username;
    `);
  const row = result.recordset[0];
  return { result: row.result, username: row.username || null };
}

async function findLinkByUsername(username) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .query(`
      SELECT Username AS username, Igsid AS igsid, IgUsername AS igUsername, LinkedAt AS linkedAt
      FROM WebInstagramLinks WHERE Username = @username
    `);
  return result.recordset[0] || null;
}

async function findLinkByIgsid(igsid) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('igsid', sql.VarChar(32), igsid)
    .query(`
      SELECT Username AS username, Igsid AS igsid, IgUsername AS igUsername, LinkedAt AS linkedAt
      FROM WebInstagramLinks WHERE Igsid = @igsid
    `);
  return result.recordset[0] || null;
}

/** Atualiza o @ do vínculo (preenchido quando a consulta de perfil acontece). */
async function updateLinkIgUsername(igsid, igUsername) {
  const pool = getPool();
  await pool
    .request()
    .input('igsid', sql.VarChar(32), igsid)
    .input('igUsername', sql.VarChar(64), igUsername)
    .query('UPDATE WebInstagramLinks SET IgUsername = @igUsername WHERE Igsid = @igsid');
}

/** Remove o vínculo e devolve o que foi removido (ou null). */
async function deleteLink(username) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .query(`
      DELETE FROM WebInstagramLinks
      OUTPUT DELETED.Igsid AS igsid, DELETED.IgUsername AS igUsername
      WHERE Username = @username
    `);
  return result.recordset[0] || null;
}

async function findRewardByIgsid(igsid) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('igsid', sql.VarChar(32), igsid)
    .query(`
      SELECT Username AS username, IgUsername AS igUsername, Amount AS amount, CreatedAt AS createdAt
      FROM WebInstagramRewards WHERE Igsid = @igsid
    `);
  return result.recordset[0] || null;
}

/**
 * Grava a menção como 'received'. Se o mid já existe (reenvio da Meta),
 * devolve { inserted: false, status } com o status atual.
 */
async function insertMention({ mid, igsid, mediaUrl }) {
  const pool = getPool();
  try {
    await pool
      .request()
      .input('mid', sql.VarChar(255), mid)
      .input('igsid', sql.VarChar(32), igsid)
      .input('mediaUrl', sql.VarChar(2048), mediaUrl ? mediaUrl.slice(0, 2048) : null)
      .query(`
        INSERT INTO WebInstagramMentions (Mid, Igsid, MediaUrl, Status)
        VALUES (@mid, @igsid, @mediaUrl, 'received')
      `);
    return { inserted: true, status: 'received' };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await pool
      .request()
      .input('mid', sql.VarChar(255), mid)
      .query('SELECT Status AS status FROM WebInstagramMentions WHERE Mid = @mid');
    return { inserted: false, status: existing.recordset[0] ? existing.recordset[0].status : null };
  }
}

async function updateMention(mid, { status, username, igUsername, followerCount }) {
  const pool = getPool();
  await pool
    .request()
    .input('mid', sql.VarChar(255), mid)
    .input('status', sql.VarChar(20), status)
    .input('username', sql.VarChar(10), username || null)
    .input('igUsername', sql.VarChar(64), igUsername || null)
    .input('followerCount', sql.Int, Number.isInteger(followerCount) ? followerCount : null)
    .query(`
      UPDATE WebInstagramMentions
      SET Status = @status,
          Username = COALESCE(@username, Username),
          IgUsername = COALESCE(@igUsername, IgUsername),
          FollowerCount = COALESCE(@followerCount, FollowerCount),
          UpdatedAt = SYSUTCDATETIME()
      WHERE Mid = @mid
    `);
}

/**
 * Prêmio atômico: grava o prêmio, credita o Cash e marca a menção como
 * 'rewarded', tudo ou nada. Uma vez por Instagram (PK no IGSID) E uma vez
 * por conta (trava de faixa no índice de Username).
 * Retorna 'rewarded' | 'already_rewarded' (Instagram) | 'account_already_rewarded'.
 */
async function rewardMention({ mid, igsid, username, igUsername, followerCount, amount }) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('mid', sql.VarChar(255), mid)
    .input('igsid', sql.VarChar(32), igsid)
    .input('username', sql.VarChar(10), username)
    .input('igUsername', sql.VarChar(64), igUsername || null)
    .input('followerCount', sql.Int, Number.isInteger(followerCount) ? followerCount : null)
    .input('amount', sql.Int, amount)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      IF EXISTS (SELECT 1 FROM WebInstagramRewards WITH (UPDLOCK, HOLDLOCK) WHERE Igsid = @igsid)
      BEGIN
        ROLLBACK TRANSACTION;
        SELECT 'already_rewarded' AS result;
        RETURN;
      END

      IF EXISTS (SELECT 1 FROM WebInstagramRewards WITH (UPDLOCK, HOLDLOCK) WHERE Username = @username)
      BEGIN
        ROLLBACK TRANSACTION;
        SELECT 'account_already_rewarded' AS result;
        RETURN;
      END

      INSERT INTO WebInstagramRewards (Igsid, Username, IgUsername, Amount, FollowerCount, MentionMid)
      VALUES (@igsid, @username, @igUsername, @amount, @followerCount, @mid);

      UPDATE MEMB_INFO
      SET Cash = Cash + @amount, modi_days = GETDATE()
      WHERE memb___id = @username;

      IF @@ROWCOUNT <> 1
      BEGIN
        ROLLBACK TRANSACTION;
        RAISERROR('Conta do premio do Instagram nao encontrada em MEMB_INFO', 16, 1);
        RETURN;
      END

      UPDATE WebInstagramMentions
      SET Status = 'rewarded', Username = @username,
          IgUsername = COALESCE(@igUsername, IgUsername),
          FollowerCount = COALESCE(@followerCount, FollowerCount),
          UpdatedAt = SYSUTCDATETIME()
      WHERE Mid = @mid;

      COMMIT TRANSACTION;
      SELECT 'rewarded' AS result;
    `);
  return result.recordset[0].result;
}

async function findRewardByUsername(username) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .query(`
      SELECT TOP 1 IgUsername AS igUsername, Amount AS amount, CreatedAt AS createdAt
      FROM WebInstagramRewards WHERE Username = @username
      ORDER BY CreatedAt ASC
    `);
  return result.recordset[0] || null;
}

/**
 * Menção mais recente ainda não resolvida (sem vínculo na época, ou perfil
 * indisponível) dentro da janela retroativa.
 */
async function findRetroactiveMention(igsid, days) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('igsid', sql.VarChar(32), igsid)
    .input('days', sql.Int, days)
    .query(`
      SELECT TOP 1 Mid AS mid
      FROM WebInstagramMentions
      WHERE Igsid = @igsid AND Status IN ('unlinked', 'profile_error')
        AND CreatedAt >= DATEADD(day, -@days, SYSUTCDATETIME())
      ORDER BY CreatedAt DESC
    `);
  return result.recordset[0] || null;
}

async function findLastMention(igsid) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('igsid', sql.VarChar(32), igsid)
    .query(`
      SELECT TOP 1 Status AS status, FollowerCount AS followerCount, CreatedAt AS createdAt
      FROM WebInstagramMentions
      WHERE Igsid = @igsid
      ORDER BY CreatedAt DESC
    `);
  return result.recordset[0] || null;
}

module.exports = {
  isUniqueViolation,
  createLinkCode,
  consumeLinkCode,
  findLinkByUsername,
  findLinkByIgsid,
  updateLinkIgUsername,
  deleteLink,
  findRewardByIgsid,
  findRewardByUsername,
  insertMention,
  updateMention,
  rewardMention,
  findRetroactiveMention,
  findLastMention,
};
