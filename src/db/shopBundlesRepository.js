const { getPool, sql } = require('./pool');

/**
 * Consulta base compartilhada por findActiveWithItems/findById — mesmas
 * colunas cruas (PascalCase) que shopItemsRepository.findActive/findById,
 * porque quem consome isso (shopController) já mapeia explicitamente pra
 * camelCase via toCatalogEntry. Não filtra por WebShopItems.Active: um
 * item pode ser componente de um pacote mesmo estando desativado pra
 * venda avulsa.
 */
// b.Id, bi.Id e i.Id são todos literalmente "Id" (WebShopBundles,
// WebShopBundleItems e WebShopItems têm cada um a sua própria PK
// chamada Id) — ORDER BY nunca deve referenciar essas colunas
// qualificadas diretamente (bi.Id não fazia parte do SELECT antes e
// causava "A column has been specified more than once in the order by
// list" nesse join de 3 tabelas). Sempre ordene pelos aliases abaixo,
// que são únicos por construção.
const BUNDLE_SELECT_COLUMNS = `
  b.Id AS Id, b.Name AS Name, b.Description AS Description, b.PriceCredits AS PriceCredits,
  b.Active AS Active, b.CreatedAt AS CreatedAt,
  bi.Id AS ComponentId, bi.Quantity AS ComponentQuantity,
  i.Id AS ItemId, i.Name AS ItemName, i.ItemGroup AS ItemGroup, i.ItemIndex AS ItemIndex,
  i.ItemLevel AS ItemLevel, i.Quantity AS ItemQuantity
`;

const BUNDLE_JOIN = `
  FROM WebShopBundles b
  JOIN WebShopBundleItems bi ON bi.BundleId = b.Id
  JOIN WebShopItems i ON i.Id = bi.ShopItemId
`;

function groupBundleRows(rows) {
  const bundles = new Map();
  for (const row of rows) {
    if (!bundles.has(row.Id)) {
      bundles.set(row.Id, {
        Id: row.Id,
        Name: row.Name,
        Description: row.Description,
        PriceCredits: row.PriceCredits,
        Active: row.Active,
        CreatedAt: row.CreatedAt,
        Items: [],
      });
    }
    bundles.get(row.Id).Items.push({
      ItemId: row.ItemId,
      ItemName: row.ItemName,
      ItemGroup: row.ItemGroup,
      ItemIndex: row.ItemIndex,
      ItemLevel: row.ItemLevel,
      ItemQuantity: row.ItemQuantity,
      ComponentQuantity: row.ComponentQuantity,
    });
  }
  return [...bundles.values()];
}

async function findActiveWithItems() {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT ${BUNDLE_SELECT_COLUMNS} ${BUNDLE_JOIN}
    WHERE b.Active = 1
    ORDER BY Id, ComponentId
  `);
  return groupBundleRows(result.recordset);
}

async function findById(id) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT ${BUNDLE_SELECT_COLUMNS} ${BUNDLE_JOIN}
      WHERE b.Id = @id
      ORDER BY ComponentId
    `);
  return groupBundleRows(result.recordset)[0] || null;
}

async function findAllAdmin() {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT
      b.Id AS id, b.Name AS name, b.Description AS description, b.PriceCredits AS priceCredits,
      b.Active AS active, b.CreatedAt AS createdAt,
      bi.Id AS componentId, bi.Quantity AS quantity,
      i.Id AS shopItemId, i.Name AS itemName
    ${BUNDLE_JOIN}
    ORDER BY id DESC, componentId
  `);

  const bundles = new Map();
  for (const row of result.recordset) {
    if (!bundles.has(row.id)) {
      bundles.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        priceCredits: row.priceCredits,
        active: row.active,
        createdAt: row.createdAt,
        items: [],
      });
    }
    bundles.get(row.id).items.push({ shopItemId: row.shopItemId, itemName: row.itemName, quantity: row.quantity });
  }
  return [...bundles.values()];
}

async function insertComponents(transaction, bundleId, items) {
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop -- inserções dependentes, precisam ser sequenciais na mesma transação
    await new sql.Request(transaction)
      .input('bundleId', sql.Int, bundleId)
      .input('shopItemId', sql.Int, item.shopItemId)
      .input('quantity', sql.TinyInt, item.quantity ?? 1)
      .query(`
        INSERT INTO WebShopBundleItems (BundleId, ShopItemId, Quantity)
        VALUES (@bundleId, @shopItemId, @quantity)
      `);
  }
}

async function create({ name, description, priceCredits, active = true, items }) {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const bundleResult = await new sql.Request(transaction)
      .input('name', sql.VarChar(50), name)
      .input('description', sql.VarChar(255), description || null)
      .input('priceCredits', sql.Int, priceCredits)
      .input('active', sql.Bit, active)
      .query(`
        INSERT INTO WebShopBundles (Name, Description, PriceCredits, Active)
        OUTPUT INSERTED.Id
        VALUES (@name, @description, @priceCredits, @active)
      `);
    const bundleId = bundleResult.recordset[0].Id;

    await insertComponents(transaction, bundleId, items);

    await transaction.commit();
    return bundleId;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

const UPDATABLE_COLUMNS = {
  name: { column: 'Name', type: sql.VarChar(50) },
  description: { column: 'Description', type: sql.VarChar(255) },
  priceCredits: { column: 'PriceCredits', type: sql.Int },
  active: { column: 'Active', type: sql.Bit },
};

/**
 * `fields.items`, quando presente, SUBSTITUI a lista de componentes
 * inteira (delete + reinsert) — mais simples e previsível pro admin do
 * que tentar diff/merge de componentes.
 */
async function update(id, fields) {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const sets = [];
    const request = new sql.Request(transaction).input('id', sql.Int, id);
    for (const [key, value] of Object.entries(fields)) {
      const spec = UPDATABLE_COLUMNS[key];
      if (!spec || value === undefined) continue;
      request.input(key, spec.type, value);
      sets.push(`${spec.column} = @${key}`);
    }
    if (sets.length > 0) {
      await request.query(`UPDATE WebShopBundles SET ${sets.join(', ')} WHERE Id = @id`);
    }

    if (fields.items) {
      await new sql.Request(transaction).input('id', sql.Int, id).query('DELETE FROM WebShopBundleItems WHERE BundleId = @id');
      await insertComponents(transaction, id, fields.items);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function setActive(id, active) {
  const pool = getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('active', sql.Bit, active)
    .query('UPDATE WebShopBundles SET Active = @active WHERE Id = @id');
}

module.exports = { findActiveWithItems, findById, findAllAdmin, create, update, setActive };
