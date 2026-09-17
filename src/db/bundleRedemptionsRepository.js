const { getPool, sql } = require('./pool');

/**
 * Uma linha por compra de pacote (não uma por item concedido — o preço
 * cobrado é o do pacote como um todo). Detalhe de quais itens/slots
 * entraram fica no WebAuditLog (eventType 'shop.bundle_redeemed').
 *
 * `CharacterName` removida da tabela (migration 0007 — resgate não é
 * mais por personagem desde que passou a ir pro baú da conta/warehouse).
 * A coluna é nullable, então este INSERT funciona mesmo antes da
 * migration 0007 rodar (fica NULL até lá).
 */
async function create({ accountId, bundleId, priceCredits }) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('bundleId', sql.Int, bundleId)
    .input('priceCredits', sql.Int, priceCredits)
    .query(`
      INSERT INTO WebBundleRedemptions (AccountId, BundleId, PriceCredits)
      VALUES (@accountId, @bundleId, @priceCredits)
    `);
}

module.exports = { create };
