const { getPool, sql } = require('./pool');

/**
 * Uma linha por compra de VIP — snapshot de tier/preço/duração no momento
 * da compra (se o admin mudar o preço do plano depois, o histórico não
 * muda retroativamente). Ver docs/SECTION_9_VIP.md.
 */
async function create({ accountId, planId, tier, priceCredits, durationDays }) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('planId', sql.Int, planId)
    .input('tier', sql.TinyInt, tier)
    .input('priceCredits', sql.Int, priceCredits)
    .input('durationDays', sql.Int, durationDays)
    .query(`
      INSERT INTO WebVipPurchases (AccountId, PlanId, Tier, PriceCredits, DurationDays)
      VALUES (@accountId, @planId, @tier, @priceCredits, @durationDays)
    `);
}

module.exports = { create };
