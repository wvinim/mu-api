const { getPool, sql } = require('./pool');

async function findActive() {
  const pool = getPool();
  const result = await pool
    .request()
    .query('SELECT Id, Name, Description, PriceCredits FROM WebShopItems WHERE Active = 1 ORDER BY PriceCredits');
  return result.recordset;
}

async function findById(id) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT Id, Name, Description, PriceCredits, ItemGroup, ItemIndex, ItemLevel, Quantity, Active
      FROM WebShopItems
      WHERE Id = @id
    `);
  return result.recordset[0] || null;
}

async function findAllAdmin() {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT Id, Name, Description, PriceCredits, ItemGroup, ItemIndex, ItemLevel, Quantity, Active, CreatedAt
    FROM WebShopItems ORDER BY Id DESC
  `);
  return result.recordset;
}

async function create({ name, description, priceCredits, itemGroup, itemIndex, itemLevel = 0, quantity = 1, active = true }) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('name', sql.VarChar(50), name)
    .input('description', sql.VarChar(255), description || null)
    .input('priceCredits', sql.Int, priceCredits)
    .input('itemGroup', sql.TinyInt, itemGroup)
    .input('itemIndex', sql.SmallInt, itemIndex)
    .input('itemLevel', sql.TinyInt, itemLevel)
    .input('quantity', sql.TinyInt, quantity)
    .input('active', sql.Bit, active)
    .query(`
      INSERT INTO WebShopItems (Name, Description, PriceCredits, ItemGroup, ItemIndex, ItemLevel, Quantity, Active)
      OUTPUT INSERTED.Id
      VALUES (@name, @description, @priceCredits, @itemGroup, @itemIndex, @itemLevel, @quantity, @active)
    `);
  return result.recordset[0].Id;
}

const UPDATABLE_COLUMNS = {
  name: { column: 'Name', type: sql.VarChar(50) },
  description: { column: 'Description', type: sql.VarChar(255) },
  priceCredits: { column: 'PriceCredits', type: sql.Int },
  itemGroup: { column: 'ItemGroup', type: sql.TinyInt },
  itemIndex: { column: 'ItemIndex', type: sql.SmallInt },
  itemLevel: { column: 'ItemLevel', type: sql.TinyInt },
  quantity: { column: 'Quantity', type: sql.TinyInt },
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

  await request.query(`UPDATE WebShopItems SET ${sets.join(', ')} WHERE Id = @id`);
}

async function setActive(id, active) {
  const pool = getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('active', sql.Bit, active)
    .query('UPDATE WebShopItems SET Active = @active WHERE Id = @id');
}

module.exports = { findActive, findById, findAllAdmin, create, update, setActive };
