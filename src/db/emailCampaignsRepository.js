const { getPool, sql } = require('./pool');

/**
 * Campanhas de e-mail de divulgação (WebEmailCampaignSends) e descadastro
 * (WebEmailUnsubscribes). Ver migration 0014 e
 * docs/SECTION_12_EMAIL_CAMPAIGNS.md. E-mails sempre em minúsculo.
 *
 * Sem JOIN entre MEMB_INFO e as tabelas novas (collation — docs/DB_NOTES.md):
 * cada lista é lida separada e o cruzamento é feito no service.
 */

/** Contas não banidas com e-mail preenchido (confirmado ou não). */
async function findRecipientAccounts() {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT memb___id AS username, memb_name AS displayName, mail_addr AS email
    FROM MEMB_INFO
    WHERE bloc_code = '0' AND mail_addr IS NOT NULL AND LTRIM(RTRIM(mail_addr)) <> ''
    ORDER BY appl_days ASC
  `);
  return result.recordset;
}

/** E-mails que já receberam a campanha com sucesso. */
async function findSentEmails(campaignKey) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('campaignKey', sql.VarChar(40), campaignKey)
    .query("SELECT Email AS email FROM WebEmailCampaignSends WHERE CampaignKey = @campaignKey AND Status = 'sent'");
  return result.recordset.map((row) => row.email);
}

async function findUnsubscribedEmails() {
  const pool = getPool();
  const result = await pool.request().query('SELECT Email AS email FROM WebEmailUnsubscribes');
  return result.recordset.map((row) => row.email);
}

/**
 * Grava o resultado de um envio. Upsert sem MERGE (compatibility level
 * antigo — docs/DB_NOTES.md): uma falha anterior vira 'sent' quando o envio
 * é retomado e dá certo.
 */
async function recordSend({ campaignKey, email, accountId, status, error = null }) {
  const pool = getPool();
  await pool
    .request()
    .input('campaignKey', sql.VarChar(40), campaignKey)
    .input('email', sql.VarChar(50), email)
    .input('accountId', sql.VarChar(10), accountId)
    .input('status', sql.VarChar(10), status)
    .input('error', sql.NVarChar(255), error ? String(error).slice(0, 255) : null)
    .query(`
      UPDATE WebEmailCampaignSends
      SET AccountId = @accountId, Status = @status, Error = @error, SentAt = SYSUTCDATETIME()
      WHERE CampaignKey = @campaignKey AND Email = @email;

      IF @@ROWCOUNT = 0
        INSERT INTO WebEmailCampaignSends (CampaignKey, Email, AccountId, Status, Error)
        VALUES (@campaignKey, @email, @accountId, @status, @error);
    `);
}

/** Totais por status de uma campanha: { sent, failed }. */
async function countByStatus(campaignKey) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('campaignKey', sql.VarChar(40), campaignKey)
    .query(`
      SELECT Status AS status, COUNT(Email) AS total
      FROM WebEmailCampaignSends
      WHERE CampaignKey = @campaignKey
      GROUP BY Status
    `);
  const counts = { sent: 0, failed: 0 };
  for (const row of result.recordset) counts[row.status] = row.total;
  return counts;
}

/** Idempotente: descadastrar de novo não dá erro. */
async function addUnsubscribe(email) {
  const pool = getPool();
  await pool
    .request()
    .input('email', sql.VarChar(50), email)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM WebEmailUnsubscribes WHERE Email = @email)
        INSERT INTO WebEmailUnsubscribes (Email) VALUES (@email);
    `);
}

module.exports = {
  findRecipientAccounts,
  findSentEmails,
  findUnsubscribedEmails,
  recordSend,
  countByStatus,
  addUnsubscribe,
};
