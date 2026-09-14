const { getPool, sql } = require('./pool');
const logger = require('../utils/logger');

/**
 * Log de auditoria da API. Nunca deve derrubar o fluxo principal — se a
 * escrita do log falhar, registramos no logger e seguimos, para não negar
 * uma ação legítima do usuário por causa de um problema no log.
 */
async function record({ accountId, username, eventType, success = true, ipAddress, userAgent, details }) {
  try {
    const pool = getPool();
    await pool
      .request()
      .input('accountId', sql.VarChar(10), accountId || null)
      .input('username', sql.VarChar(10), username || null)
      .input('eventType', sql.VarChar(50), eventType)
      .input('success', sql.Bit, success)
      .input('ipAddress', sql.VarChar(45), ipAddress || null)
      .input('userAgent', sql.VarChar(255), userAgent || null)
      .input('details', sql.NVarChar(sql.MAX), details ? JSON.stringify(details) : null)
      .query(`
        INSERT INTO WebAuditLog (AccountId, Username, EventType, Success, IpAddress, UserAgent, Details)
        VALUES (@accountId, @username, @eventType, @success, @ipAddress, @userAgent, @details)
      `);
  } catch (err) {
    logger.error({ err, eventType }, 'Falha ao gravar log de auditoria');
  }
}

/**
 * Paginação via ROW_NUMBER() em vez de OFFSET/FETCH — o banco está em um
 * compatibility level anterior ao SQL Server 2012, que não suporta a
 * sintaxe OFFSET/FETCH NEXT (erro "Invalid usage of the option NEXT").
 * ROW_NUMBER() funciona em qualquer versão com suporte a CTE (SQL 2005+).
 */
async function findByAccount(accountId, { page = 1, limit = 20 } = {}) {
  const pool = getPool();
  const firstRow = (page - 1) * limit + 1;
  const lastRow = page * limit;
  const result = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('firstRow', sql.Int, firstRow)
    .input('lastRow', sql.Int, lastRow)
    .query(`
      WITH Numbered AS (
        SELECT
          EventType AS eventType,
          Success AS success,
          IpAddress AS ipAddress,
          CreatedAt AS createdAt,
          ROW_NUMBER() OVER (ORDER BY CreatedAt DESC) AS RowNum
        FROM WebAuditLog
        WHERE AccountId = @accountId
      )
      SELECT eventType, success, ipAddress, createdAt
      FROM Numbered
      WHERE RowNum BETWEEN @firstRow AND @lastRow
      ORDER BY RowNum;

      SELECT COUNT(*) AS total FROM WebAuditLog WHERE AccountId = @accountId;
    `);
  return {
    items: result.recordsets[0],
    total: result.recordsets[1][0].total,
  };
}

/** Listagem geral (todas as contas) para o painel de administração. */
async function findAll({ page = 1, limit = 20, accountId, eventType } = {}) {
  const pool = getPool();
  const firstRow = (page - 1) * limit + 1;
  const lastRow = page * limit;
  const request = pool.request().input('firstRow', sql.Int, firstRow).input('lastRow', sql.Int, lastRow);

  const filters = [];
  if (accountId) {
    request.input('accountId', sql.VarChar(10), accountId);
    filters.push('AccountId = @accountId');
  }
  if (eventType) {
    request.input('eventType', sql.VarChar(50), eventType);
    filters.push('EventType = @eventType');
  }
  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await request.query(`
    WITH Ranked AS (
      SELECT
        AccountId AS accountId, Username AS username, EventType AS eventType, Success AS success,
        IpAddress AS ipAddress, CreatedAt AS createdAt,
        ROW_NUMBER() OVER (ORDER BY CreatedAt DESC) AS rank
      FROM WebAuditLog
      ${whereClause}
    )
    SELECT accountId, username, eventType, success, ipAddress, createdAt
    FROM Ranked WHERE rank BETWEEN @firstRow AND @lastRow ORDER BY rank;

    SELECT COUNT(*) AS total FROM WebAuditLog ${whereClause};
  `);

  return { items: result.recordsets[0], total: result.recordsets[1][0].total };
}

module.exports = { record, findByAccount, findAll };
