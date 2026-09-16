const { getPool, sql } = require('./pool');

/**
 * Uma linha por compra de pacote (não uma por item concedido — o preço
 * cobrado é o do pacote como um todo). Detalhe de quais itens/slots
 * entraram fica no WebAuditLog (eventType 'shop.bundle_redeemed').
 */
async function create({ accountId, characterName, bundleId, priceCredits }) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('characterName', sql.VarChar(10), characterName)
    .input('bundleId', sql.Int, bundleId)
    .input('priceCredits', sql.Int, priceCredits)
    .query(`
      INSERT INTO WebBundleRedemptions (AccountId, CharacterName, BundleId, PriceCredits)
      VALUES (@accountId, @characterName, @bundleId, @priceCredits)
    `);
}

module.exports = { create };
