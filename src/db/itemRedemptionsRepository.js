const { getPool, sql } = require('./pool');

/**
 * `CharacterName` removida da tabela (migration 0007 — resgate não é
 * mais por personagem desde que passou a ir pro baú da conta/warehouse).
 * A coluna é nullable, então este INSERT funciona mesmo antes da
 * migration 0007 rodar (fica NULL até lá).
 */
async function create({ accountId, shopItemId, priceCredits, slot }) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('shopItemId', sql.Int, shopItemId)
    .input('priceCredits', sql.Int, priceCredits)
    .input('slot', sql.TinyInt, slot)
    .query(`
      INSERT INTO WebItemRedemptions (AccountId, ShopItemId, PriceCredits, Slot)
      VALUES (@accountId, @shopItemId, @priceCredits, @slot)
    `);
}

module.exports = { create };
