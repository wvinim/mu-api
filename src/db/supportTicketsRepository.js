const { getPool, sql } = require('./pool');

async function addReply({ ticketId, accountId, message }) {
  const pool = getPool();
  await pool
    .request()
    .input('ticketId', sql.Int, ticketId)
    .input('accountId', sql.VarChar(10), accountId)
    .input('message', sql.NVarChar(sql.MAX), message)
    .query(`
      INSERT INTO WebSupportReplies (TicketId, AuthorAccountId, Message)
      VALUES (@ticketId, @accountId, @message);

      UPDATE WebSupportTickets SET UpdatedAt = SYSUTCDATETIME() WHERE Id = @ticketId;
    `);
}

async function createTicket({ accountId, subject, message }) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('subject', sql.VarChar(200), subject)
    .query(`
      INSERT INTO WebSupportTickets (AccountId, Subject)
      OUTPUT INSERTED.Id
      VALUES (@accountId, @subject)
    `);
  const ticketId = result.recordset[0].Id;
  await addReply({ ticketId, accountId, message });
  return ticketId;
}

async function findById(id) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT Id AS id, AccountId AS accountId, Subject AS subject, Status AS status,
             CreatedAt AS createdAt, UpdatedAt AS updatedAt
      FROM WebSupportTickets WHERE Id = @id
    `);
  return result.recordset[0] || null;
}

async function findRepliesByTicket(ticketId) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('ticketId', sql.Int, ticketId)
    .query(`
      SELECT Id AS id, AuthorAccountId AS authorAccountId, Message AS message, CreatedAt AS createdAt
      FROM WebSupportReplies WHERE TicketId = @ticketId ORDER BY CreatedAt ASC
    `);
  return result.recordset;
}

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
      WITH Ranked AS (
        SELECT Id AS id, Subject AS subject, Status AS status, CreatedAt AS createdAt, UpdatedAt AS updatedAt,
               ROW_NUMBER() OVER (ORDER BY UpdatedAt DESC) AS rank
        FROM WebSupportTickets WHERE AccountId = @accountId
      )
      SELECT id, subject, status, createdAt, updatedAt FROM Ranked WHERE rank BETWEEN @firstRow AND @lastRow ORDER BY rank;

      SELECT COUNT(*) AS total FROM WebSupportTickets WHERE AccountId = @accountId;
    `);
  return { items: result.recordsets[0], total: result.recordsets[1][0].total };
}

async function findAll({ page = 1, limit = 20 } = {}) {
  const pool = getPool();
  const firstRow = (page - 1) * limit + 1;
  const lastRow = page * limit;
  const result = await pool
    .request()
    .input('firstRow', sql.Int, firstRow)
    .input('lastRow', sql.Int, lastRow)
    .query(`
      WITH Ranked AS (
        SELECT Id AS id, AccountId AS accountId, Subject AS subject, Status AS status,
               CreatedAt AS createdAt, UpdatedAt AS updatedAt,
               ROW_NUMBER() OVER (ORDER BY UpdatedAt DESC) AS rank
        FROM WebSupportTickets
      )
      SELECT id, accountId, subject, status, createdAt, updatedAt FROM Ranked WHERE rank BETWEEN @firstRow AND @lastRow ORDER BY rank;

      SELECT COUNT(*) AS total FROM WebSupportTickets;
    `);
  return { items: result.recordsets[0], total: result.recordsets[1][0].total };
}

module.exports = { createTicket, addReply, findById, findRepliesByTicket, findByAccount, findAll };
