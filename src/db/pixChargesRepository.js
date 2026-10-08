const { getPool, sql } = require('./pool');

/**
 * Cria a cobrança. Se for presente (`giftCode` informado), cria também a
 * chave em WebGiftCodes como 'awaiting_payment' na MESMA transação — nunca
 * existe cobrança de presente sem chave (o webhook depende disso para
 * liberar a chave em vez de creditar o comprador).
 */
async function create({ accountId, packageId, txid, amountCents, creditsAmount, giftCode = null }) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('packageId', sql.Int, packageId)
    .input('txid', sql.VarChar(35), txid)
    .input('amountCents', sql.Int, amountCents)
    .input('creditsAmount', sql.Int, creditsAmount)
    .input('giftCode', sql.VarChar(32), giftCode)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      DECLARE @chargeId BIGINT;

      INSERT INTO WebPixCharges (AccountId, PackageId, TxId, AmountCents, CreditsAmount, IsGift)
      VALUES (@accountId, @packageId, @txid, @amountCents, @creditsAmount,
              CASE WHEN @giftCode IS NULL THEN 0 ELSE 1 END);

      SET @chargeId = SCOPE_IDENTITY();

      IF @giftCode IS NOT NULL
        INSERT INTO WebGiftCodes (Code, PixChargeId, BuyerAccountId, CreditsAmount, Status)
        VALUES (@giftCode, @chargeId, @accountId, @creditsAmount, 'awaiting_payment');

      COMMIT TRANSACTION;
    `);
}

async function findByTxId(txid) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('txid', sql.VarChar(35), txid)
    .query(`
      SELECT Id, AccountId, PackageId, TxId, AmountCents, CreditsAmount, Status, IsGift, CreatedAt, PaidAt
      FROM WebPixCharges
      WHERE TxId = @txid
    `);
  return result.recordset[0] || null;
}

/**
 * Marca a cobrança como paga E entrega o que foi comprado na mesma transação:
 * credita o Cash do comprador ou, se for presente, libera a chave
 * (awaiting_payment -> available) sem creditar ninguém.
 *
 * - Idempotência: só age se a cobrança ainda estava 'pending' — webhook
 *   reenviado/processado duas vezes não credita de novo.
 * - Atomicidade: antes eram dois comandos separados (marcar pago, depois
 *   creditar); uma falha entre eles deixava a cobrança "paga" sem Cash, e
 *   os reenvios da Efí não corrigiam (já não estava mais pending). Agora,
 *   se o crédito falhar, nada é gravado, a API responde erro e a Efí
 *   reenvia o webhook.
 * - Conta inexistente em MEMB_INFO (ou presente sem chave aguardando):
 *   ROLLBACK + RAISERROR (a cobrança continua pending e o erro aparece no
 *   log), nunca "paga sem crédito".
 * - Sem JOIN com MEMB_INFO (evita conflito de collation — ver
 *   docs/DB_NOTES.md): conta e créditos vão para variáveis.
 *
 * Retorna { credited: true, accountId, creditsAmount, isGift } quando esta
 * chamada processou, ou { credited: false } se já tinha sido processada.
 */
async function markPaidAndCredit(txid) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('txid', sql.VarChar(35), txid)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      DECLARE @chargeId BIGINT, @accountId VARCHAR(10), @creditsAmount INT, @isGift BIT;

      UPDATE WebPixCharges
      SET Status = 'paid', PaidAt = SYSUTCDATETIME(),
          @chargeId = Id, @accountId = AccountId, @creditsAmount = CreditsAmount, @isGift = IsGift
      WHERE TxId = @txid AND Status = 'pending';

      IF @@ROWCOUNT = 1
      BEGIN
        IF @isGift = 1
        BEGIN
          UPDATE WebGiftCodes
          SET Status = 'available', PaidAt = SYSUTCDATETIME()
          WHERE PixChargeId = @chargeId AND Status = 'awaiting_payment';

          IF @@ROWCOUNT <> 1
          BEGIN
            ROLLBACK TRANSACTION;
            RAISERROR('Chave de presente da cobranca Pix nao encontrada', 16, 1);
            RETURN;
          END
        END
        ELSE
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
      END

      COMMIT TRANSACTION;
      SELECT @accountId AS accountId, @creditsAmount AS creditsAmount, @isGift AS isGift;
    `);
  const row = result.recordset[0];
  return row && row.accountId
    ? { credited: true, accountId: row.accountId, creditsAmount: row.creditsAmount, isGift: Boolean(row.isGift) }
    : { credited: false };
}

module.exports = { create, findByTxId, markPaidAndCredit };
