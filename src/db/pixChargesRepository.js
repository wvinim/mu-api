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
 * Marca a cobrança como paga E credita o Cash na mesma transação.
 *
 * - Idempotência: só age se a cobrança ainda estava 'pending' — webhook
 *   reenviado/processado duas vezes não credita de novo.
 * - Atomicidade: antes eram dois comandos separados (marcar pago, depois
 *   creditar); uma falha entre eles deixava a cobrança "paga" sem Cash, e
 *   os reenvios da Efí não corrigiam (já não estava mais pending). Agora,
 *   se o crédito falhar, nada é gravado, a API responde erro e a Efí
 *   reenvia o webhook.
 * - Conta inexistente em MEMB_INFO: ROLLBACK + RAISERROR (a cobrança continua
 *   pending e o erro aparece no log), nunca "paga sem crédito".
 * - Sem JOIN com MEMB_INFO (evita conflito de collation — ver
 *   docs/DB_NOTES.md): conta e créditos vão para variáveis.
 *
 * Retorna { credited: true, accountId, creditsAmount } quando esta chamada
 * creditou, ou { credited: false } se já tinha sido processada.
 */
async function markPaidAndCredit(txid) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('txid', sql.VarChar(35), txid)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      DECLARE @accountId VARCHAR(10), @creditsAmount INT;

      UPDATE WebPixCharges
      SET Status = 'paid', PaidAt = SYSUTCDATETIME(),
          @accountId = AccountId, @creditsAmount = CreditsAmount
      WHERE TxId = @txid AND Status = 'pending';

      IF @@ROWCOUNT = 1
      BEGIN
        UPDATE MEMB_INFO
        SET Cash = Cash + @creditsAmount, modi_days = GETDATE()
        WHERE memb___id = @accountId;

        IF @@ROWCOUNT <> 1
        BEGIN
          -- RAISERROR em vez de THROW: THROW não existe com compatibility
          -- level < 110 (o banco do MU recusou com "Incorrect syntax near
          -- 'THROW'"). RAISERROR não aborta a transação sozinho, mesmo com
          -- XACT_ABORT — por isso o ROLLBACK explícito antes.
          ROLLBACK TRANSACTION;
          RAISERROR('Conta da cobranca Pix nao encontrada em MEMB_INFO', 16, 1);
          RETURN;
        END
      END

      COMMIT TRANSACTION;
      SELECT @accountId AS accountId, @creditsAmount AS creditsAmount;
    `);
  const row = result.recordset[0];
  return row && row.accountId
    ? { credited: true, accountId: row.accountId, creditsAmount: row.creditsAmount }
    : { credited: false };
}

module.exports = { create, findByTxId, markPaidAndCredit };
