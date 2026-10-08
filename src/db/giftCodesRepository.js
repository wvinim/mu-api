const { getPool, sql } = require('./pool');

/**
 * Chaves de gold de presente (WebGiftCodes). Ver migration 0012 e
 * docs/SECTION_10_GIFT_CODES.md. A chave em si é segredo do comprador:
 * só sai daqui para o dono (ou admin), e nunca enquanto 'awaiting_payment'.
 */

async function findByPixChargeId(pixChargeId) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('pixChargeId', sql.BigInt, pixChargeId)
    .query(`
      SELECT Id, Code, PixChargeId, BuyerAccountId, CreditsAmount, Status, CreatedAt, PaidAt, RedeemedAt
      FROM WebGiftCodes
      WHERE PixChargeId = @pixChargeId
    `);
  return result.recordset[0] || null;
}

/**
 * Chaves compradas pela conta, mais recentes primeiro. Chaves ainda
 * aguardando pagamento só aparecem enquanto a cobrança Pix pode ser paga
 * (`awaitingWindowSeconds` = expiração da cobrança); depois disso a cobrança
 * expirou na Efí e a chave nunca vai ser liberada — não polui a lista.
 */
async function findByBuyer(accountId, { page = 1, limit = 20, awaitingWindowSeconds }) {
  const pool = getPool();
  const firstRow = (page - 1) * limit + 1;
  const lastRow = page * limit;
  const where = `
    BuyerAccountId = @accountId
    AND (Status <> 'awaiting_payment' OR CreatedAt >= DATEADD(second, -@awaitingWindowSeconds, SYSUTCDATETIME()))
  `;

  const result = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('awaitingWindowSeconds', sql.Int, awaitingWindowSeconds)
    .input('firstRow', sql.Int, firstRow)
    .input('lastRow', sql.Int, lastRow)
    .query(`
      WITH Ranked AS (
        SELECT
          Id AS id,
          CASE WHEN Status = 'awaiting_payment' THEN NULL ELSE Code END AS code,
          CreditsAmount AS creditsAmount, Status AS status,
          CreatedAt AS createdAt, PaidAt AS paidAt, RedeemedAt AS redeemedAt,
          ROW_NUMBER() OVER (ORDER BY CreatedAt DESC, Id DESC) AS rank
        FROM WebGiftCodes
        WHERE ${where}
      )
      SELECT id, code, creditsAmount, status, createdAt, paidAt, redeemedAt
      FROM Ranked WHERE rank BETWEEN @firstRow AND @lastRow ORDER BY rank;

      SELECT COUNT(Id) AS total FROM WebGiftCodes WHERE ${where};
    `);

  return { items: result.recordsets[0], total: result.recordsets[1][0].total };
}

/**
 * Resgate atômico: marca a chave como resgatada E credita o Cash na mesma
 * transação. `Status = 'available'` no WHERE garante que dois resgates
 * simultâneos da mesma chave não creditam duas vezes (o UPDATE trava a
 * linha). Sem JOIN com MEMB_INFO (collation — docs/DB_NOTES.md).
 *
 * Retorna { redeemed: true, id, creditsAmount } ou { redeemed: false }.
 */
async function redeem(code, accountId) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('code', sql.VarChar(32), code)
    .input('accountId', sql.VarChar(10), accountId)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      DECLARE @id BIGINT, @creditsAmount INT;

      UPDATE WebGiftCodes
      SET Status = 'redeemed', RedeemedByAccountId = @accountId, RedeemedAt = SYSUTCDATETIME(),
          @id = Id, @creditsAmount = CreditsAmount
      WHERE Code = @code AND Status = 'available';

      IF @@ROWCOUNT = 1
      BEGIN
        UPDATE MEMB_INFO
        SET Cash = Cash + @creditsAmount, modi_days = GETDATE()
        WHERE memb___id = @accountId;

        IF @@ROWCOUNT <> 1
        BEGIN
          ROLLBACK TRANSACTION;
          RAISERROR('Conta do resgate de presente nao encontrada em MEMB_INFO', 16, 1);
          RETURN;
        END
      END

      COMMIT TRANSACTION;
      SELECT @id AS id, @creditsAmount AS creditsAmount;
    `);
  const row = result.recordset[0];
  return row && row.id ? { redeemed: true, id: row.id, creditsAmount: row.creditsAmount } : { redeemed: false };
}

async function findStatusByCode(code) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('code', sql.VarChar(32), code)
    .query('SELECT Status FROM WebGiftCodes WHERE Code = @code');
  return result.recordset[0]?.Status || null;
}

/**
 * Lista do admin. `code` aceita só o formato canônico (o controller
 * normaliza); `accountId` casa com comprador OU com quem resgatou.
 */
async function findAllAdmin({ page = 1, limit = 20, code, accountId, status } = {}) {
  const pool = getPool();
  const firstRow = (page - 1) * limit + 1;
  const lastRow = page * limit;
  const request = pool.request().input('firstRow', sql.Int, firstRow).input('lastRow', sql.Int, lastRow);

  const filters = [];
  if (code) {
    request.input('code', sql.VarChar(32), code);
    filters.push('g.Code = @code');
  }
  if (accountId) {
    request.input('accountId', sql.VarChar(10), accountId);
    filters.push('(g.BuyerAccountId = @accountId OR g.RedeemedByAccountId = @accountId)');
  }
  if (status) {
    request.input('status', sql.VarChar(20), status);
    filters.push('g.Status = @status');
  }
  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await request.query(`
    WITH Ranked AS (
      SELECT
        g.Id AS id, g.Code AS code, g.BuyerAccountId AS buyerAccountId, g.CreditsAmount AS creditsAmount,
        g.Status AS status, p.TxId AS txid, p.AmountCents AS amountCents,
        g.CreatedAt AS createdAt, g.PaidAt AS paidAt,
        g.RedeemedByAccountId AS redeemedByAccountId, g.RedeemedAt AS redeemedAt,
        g.CancelledBy AS cancelledBy, g.CancelledAt AS cancelledAt,
        ROW_NUMBER() OVER (ORDER BY g.CreatedAt DESC, g.Id DESC) AS rank
      FROM WebGiftCodes g
      JOIN WebPixCharges p ON p.Id = g.PixChargeId
      ${whereClause}
    )
    SELECT id, code, buyerAccountId, creditsAmount, status, txid, amountCents, createdAt, paidAt,
           redeemedByAccountId, redeemedAt, cancelledBy, cancelledAt
    FROM Ranked WHERE rank BETWEEN @firstRow AND @lastRow ORDER BY rank;

    SELECT COUNT(g.Id) AS total FROM WebGiftCodes g ${whereClause};
  `);

  return { items: result.recordsets[0], total: result.recordsets[1][0].total };
}

/** Só cancela chave 'available' (paga e ainda não resgatada). */
async function cancel(id, adminUsername) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('admin', sql.VarChar(10), adminUsername)
    .query(`
      UPDATE WebGiftCodes
      SET Status = 'cancelled', CancelledBy = @admin, CancelledAt = SYSUTCDATETIME()
      OUTPUT INSERTED.BuyerAccountId AS buyerAccountId, INSERTED.CreditsAmount AS creditsAmount, INSERTED.Code AS code
      WHERE Id = @id AND Status = 'available'
    `);
  return result.recordset[0] || null;
}

async function findStatusById(id) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query('SELECT Status FROM WebGiftCodes WHERE Id = @id');
  return result.recordset[0]?.Status || null;
}

module.exports = {
  findByPixChargeId,
  findByBuyer,
  redeem,
  findStatusByCode,
  findAllAdmin,
  cancel,
  findStatusById,
};
