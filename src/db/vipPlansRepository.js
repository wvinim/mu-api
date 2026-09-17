const { getPool, sql } = require('./pool');

/**
 * Catálogo de planos VIP — sempre exatamente 3 linhas (tier 1/2/3), semeadas
 * pela migration 0006. Admin só edita PriceCredits/Active (ver
 * docs/SECTION_9_VIP.md — decisão explícita do usuário: catálogo fixo,
 * não é um CRUD livre como WebShopItems/WebShopBundles).
 */
async function findActive() {
  const pool = getPool();
  const result = await pool
    .request()
    .query('SELECT Id, Tier, Name, PriceCredits, DurationDays FROM WebVipPlans WHERE Active = 1 ORDER BY Tier');
  return result.recordset;
}

async function findById(id) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT Id, Tier, Name, PriceCredits, DurationDays, Active FROM WebVipPlans WHERE Id = @id');
  return result.recordset[0] || null;
}

async function findAllAdmin() {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT Id AS id, Tier AS tier, Name AS name, PriceCredits AS priceCredits,
           DurationDays AS durationDays, Active AS active, CreatedAt AS createdAt
    FROM WebVipPlans ORDER BY Tier
  `);
  return result.recordset;
}

/** Só PriceCredits/Active são editáveis — Tier/Name/DurationDays são fixos (ver migration 0006). */
async function update(id, { priceCredits, active }) {
  const pool = getPool();
  const request = pool.request().input('id', sql.Int, id);
  const sets = [];

  if (priceCredits !== undefined) {
    request.input('priceCredits', sql.Int, priceCredits);
    sets.push('PriceCredits = @priceCredits');
  }
  if (active !== undefined) {
    request.input('active', sql.Bit, active);
    sets.push('Active = @active');
  }
  if (sets.length === 0) return;

  await request.query(`UPDATE WebVipPlans SET ${sets.join(', ')} WHERE Id = @id`);
}

module.exports = { findActive, findById, findAllAdmin, update };
