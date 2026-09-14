const { getPool, sql } = require('./pool');

async function create({ accountId, characterName, shopItemId, priceCredits, slot }) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('characterName', sql.VarChar(10), characterName)
    .input('shopItemId', sql.Int, shopItemId)
    .input('priceCredits', sql.Int, priceCredits)
    .input('slot', sql.TinyInt, slot)
    .query(`
      INSERT INTO WebItemRedemptions (AccountId, CharacterName, ShopItemId, PriceCredits, Slot)
      VALUES (@accountId, @characterName, @shopItemId, @priceCredits, @slot)
    `);
}

module.exports = { create };
