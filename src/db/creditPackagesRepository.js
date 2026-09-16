const { getPool, sql } = require('./pool');

async function findActive() {
  const pool = getPool();
  const result = await pool
    .request()
    .query('SELECT Id, Name, PriceCents, CreditsAmount FROM WebCreditPackages WHERE Active = 1 ORDER BY PriceCents');
  return result.recordset;
}

async function findById(id) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT Id, Name, PriceCents, CreditsAmount, Active FROM WebCreditPackages WHERE Id = @id');
  return result.recordset[0] || null;
}

async function findAllAdmin() {
  const pool = getPool();
  const result = await pool
    .request()
    .query(`
      SELECT Id AS id, Name AS name, PriceCents AS priceCents, CreditsAmount AS creditsAmount,
             Active AS active, CreatedAt AS createdAt
      FROM WebCreditPackages ORDER BY Id DESC
    `);
  return result.recordset;
}

async function create({ name, priceCents, creditsAmount, active = true }) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('name', sql.VarChar(50), name)
    .input('priceCents', sql.Int, priceCents)
    .input('creditsAmount', sql.Int, creditsAmount)
    .input('active', sql.Bit, active)
    .query(`
      INSERT INTO WebCreditPackages (Name, PriceCents, CreditsAmount, Active)
      OUTPUT INSERTED.Id
      VALUES (@name, @priceCents, @creditsAmount, @active)
    `);
  return result.recordset[0].Id;
}

const UPDATABLE_COLUMNS = {
  name: { column: 'Name', type: sql.VarChar(50) },
  priceCents: { column: 'PriceCents', type: sql.Int },
  creditsAmount: { column: 'CreditsAmount', type: sql.Int },
  active: { column: 'Active', type: sql.Bit },
};

async function update(id, fields) {
  const pool = getPool();
  const request = pool.request().input('id', sql.Int, id);
  const sets = [];

  for (const [key, value] of Object.entries(fields)) {
    const spec = UPDATABLE_COLUMNS[key];
    if (!spec || value === undefined) continue;
    request.input(key, spec.type, value);
    sets.push(`${spec.column} = @${key}`);
  }
  if (sets.length === 0) return;

  await request.query(`UPDATE WebCreditPackages SET ${sets.join(', ')} WHERE Id = @id`);
}

async function setActive(id, active) {
  const pool = getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('active', sql.Bit, active)
    .query('UPDATE WebCreditPackages SET Active = @active WHERE Id = @id');
}

module.exports = { findActive, findById, findAllAdmin, create, update, setActive };
