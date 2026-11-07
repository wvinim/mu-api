const { getPool, sql } = require('./pool');

/**
 * Links rastreáveis de campanha (mupro.vip/bonus/<codigo>). Ver migration
 * 0015 e docs/SECTION_13_CAMPAIGN_LINKS.md. Campanhas são cadastradas direto
 * no banco; a API só lê WebCampaigns.
 */

const UNIQUE_VIOLATION = new Set([2627, 2601]);

/**
 * Grava a primeira visita de um navegador (visitorId) a uma campanha.
 * Retorna 'not_found' (campanha não cadastrada), 'duplicate' (esse
 * navegador já tinha visitado essa campanha) ou 'recorded'.
 */
async function recordVisit({ code, visitorId, ip, userAgent }) {
  const pool = getPool();
  try {
    const result = await pool
      .request()
      .input('code', sql.VarChar(30), code)
      .input('visitorId', sql.Char(36), visitorId)
      .input('ip', sql.VarChar(45), ip ? ip.slice(0, 45) : null)
      .input('userAgent', sql.NVarChar(255), userAgent ? userAgent.slice(0, 255) : null)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM WebCampaigns WHERE Code = @code)
          SELECT 'not_found' AS outcome;
        ELSE IF EXISTS (SELECT 1 FROM WebCampaignVisits WHERE CampaignCode = @code AND VisitorId = @visitorId)
          SELECT 'duplicate' AS outcome;
        ELSE
        BEGIN
          INSERT INTO WebCampaignVisits (CampaignCode, VisitorId, Ip, UserAgent)
          VALUES (@code, @visitorId, @ip, @userAgent);
          SELECT 'recorded' AS outcome;
        END
      `);
    return result.recordset[0].outcome;
  } catch (err) {
    // Duas requisições simultâneas do mesmo navegador (ex.: Strict Mode em
    // dev): a segunda bate na UNIQUE (CampaignCode, VisitorId).
    if (UNIQUE_VIOLATION.has(err.number)) return 'duplicate';
    throw err;
  }
}

/**
 * Atribui a conta recém-criada à campanha, se ela ainda estiver cadastrada.
 * VisitId aponta para a visita desse navegador, quando existir.
 * Retorna true se gravou, false se a campanha não existe (ou a conta já
 * tinha atribuição).
 */
async function recordReferral({ username, code, visitorId, ip }) {
  const pool = getPool();
  try {
    const result = await pool
      .request()
      .input('username', sql.VarChar(10), username)
      .input('code', sql.VarChar(30), code)
      .input('visitorId', sql.Char(36), visitorId || null)
      .input('ip', sql.VarChar(45), ip ? ip.slice(0, 45) : null)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM WebCampaigns WHERE Code = @code)
          SELECT CAST(0 AS BIT) AS recorded;
        ELSE
        BEGIN
          INSERT INTO WebAccountReferrals (Username, CampaignCode, VisitId, Ip)
          VALUES (
            @username,
            @code,
            (SELECT Id FROM WebCampaignVisits WHERE CampaignCode = @code AND VisitorId = @visitorId),
            @ip
          );
          SELECT CAST(1 AS BIT) AS recorded;
        END
      `);
    return Boolean(result.recordset[0].recorded);
  } catch (err) {
    if (UNIQUE_VIOLATION.has(err.number)) return false;
    throw err;
  }
}

module.exports = { recordVisit, recordReferral };
