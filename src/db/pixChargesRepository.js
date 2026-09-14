const { getPool, sql } = require('./pool');

async function create({ accountId, packageId, txid, amountCents, creditsAmount }) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('packageId', sql.Int, packageId)
    .input('txid', sql.VarChar(35), txid)
    .input('amountCents', sql.Int, amountCents)
    .input('creditsAmount', sql.Int, creditsAmount)
    .query(`
      INSERT INTO WebPixCharges (AccountId, PackageId, TxId, AmountCents, CreditsAmount)
      VALUES (@accountId, @packageId, @txid, @amountCents, @creditsAmount)
    `);
}

async function findByTxId(txid) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('txid', sql.VarChar(35), txid)
    .query(`
      SELECT Id, AccountId, PackageId, TxId, AmountCents, CreditsAmount, Status, CreatedAt, PaidAt
      FROM WebPixCharges
      WHERE TxId = @txid
    `);
  return result.recordset[0] || null;
}

/**
 * Marca como paga SOMENTE se ainda estava pendente — é isso que garante
 * idempotência caso a Efí reenvie o mesmo webhook (ou caso ele seja
 * processado duas vezes por qualquer motivo). Retorna true só quando
 * esta chamada foi quem de fato mudou o status (ou seja, quando é seguro
 * creditar Cash).
 */
async function markPaid(txid) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('txid', sql.VarChar(35), txid)
    .query(`
      UPDATE WebPixCharges
      SET Status = 'paid', PaidAt = SYSUTCDATETIME()
      WHERE TxId = @txid AND Status = 'pending'
    `);
  return result.rowsAffected[0] > 0;
}

module.exports = { create, findByTxId, markPaid };
