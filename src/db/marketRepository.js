const { getPool, sql } = require('./pool');

/**
 * Mercado entre jogadores (docs/SECTION_14_MARKET.md, migration 0016).
 *
 * Leitura de baú: WITH (NOLOCK), de propósito. A API nunca espera nem trava
 * o jogo ao ler um baú. Se a leitura pegar um conteúdo que o jogo ainda não
 * confirmou, a procedure recusa a gravação (ela exige `Items = @oldItems`,
 * comparando com o valor confirmado) e a API relê. Nenhuma escrita depende
 * de uma leitura suja dar certo.
 *
 * Extwarehouse.AccountID é CI_AS e as contas são CS_AS ("Joao" ≠ "joao"):
 * a igualdade CI usa o índice e a CS filtra.
 *
 * Escritas: só pelas procedures WebMarket_* (o mu_api não tem UPDATE em
 * WebMarketListings nem em Extwarehouse).
 */

const VAULT_COLUMNS_SQL = 'VaultID AS vaultId, Items AS items';

async function listVaults(accountId) {
  const pool = getPool();
  const active = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .query(`SELECT ${VAULT_COLUMNS_SQL} FROM warehouse WITH (NOLOCK) WHERE AccountID = @accountId`);
  const stored = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .query(`
      SELECT ${VAULT_COLUMNS_SQL} FROM Extwarehouse WITH (NOLOCK)
      WHERE AccountID = @accountId AND AccountID COLLATE Latin1_General_CS_AS = @accountId
      ORDER BY VaultID
    `);
  return {
    active: active.recordset.map((r) => ({ ...r, stored: false })),
    stored: stored.recordset.map((r) => ({ ...r, stored: true })),
  };
}

/** Um baú da conta pelo número. `duplicated` = a conta tem mais de uma linha de baú ativo. */
async function findVault(accountId, vaultId) {
  const { active, stored } = await listVaults(accountId);
  if (active.length > 1) return { duplicated: true };
  const vault = [...active, ...stored].find((v) => v.vaultId === vaultId);
  return vault || null;
}

function execResult(result) {
  const row = result.recordset && result.recordset[0];
  return row || { Result: -1 };
}

async function createListing(params) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('account', sql.VarChar(10), params.accountId)
    .input('vaultId', sql.Int, params.vaultId)
    .input('stored', sql.Bit, params.stored)
    .input('slot', sql.Int, params.slot)
    .input('oldItems', sql.VarBinary(1920), params.oldItems)
    .input('newItems', sql.VarBinary(1920), params.newItems)
    .input('itemBytes', sql.VarBinary(16), params.itemBytes)
    .input('itemGroup', sql.TinyInt, params.item.group)
    .input('itemIndex', sql.SmallInt, params.item.index)
    .input('itemName', sql.VarChar(50), params.item.name)
    .input('category', sql.VarChar(20), params.item.category)
    .input('itemLevel', sql.TinyInt, params.item.level)
    .input('excMask', sql.TinyInt, params.item.excMask)
    .input('excCount', sql.TinyInt, params.item.excCount)
    .input('hasSkill', sql.Bit, params.item.skill)
    .input('hasLuck', sql.Bit, params.item.luck)
    .input('addOption', sql.TinyInt, params.item.additionalOption)
    .input('itemSerial', sql.BigInt, params.item.serial)
    .input('width', sql.TinyInt, params.item.width)
    .input('height', sql.TinyInt, params.item.height)
    .input('price', sql.Int, params.price)
    .execute('dbo.WebMarket_Create');
  return execResult(result);
}

async function buyListing({ listingId, accountId, vaultId, stored, slot, oldItems, newItems }) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('listingId', sql.BigInt, listingId)
    .input('buyer', sql.VarChar(10), accountId)
    .input('vaultId', sql.Int, vaultId)
    .input('stored', sql.Bit, stored)
    .input('slot', sql.Int, slot)
    .input('oldItems', sql.VarBinary(1920), oldItems)
    .input('newItems', sql.VarBinary(1920), newItems)
    .execute('dbo.WebMarket_Buy');
  return execResult(result);
}

async function returnListing({ listingId, accountId, vaultId, stored, slot, oldItems, newItems }) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('listingId', sql.BigInt, listingId)
    .input('account', sql.VarChar(10), accountId)
    .input('vaultId', sql.Int, vaultId)
    .input('stored', sql.Bit, stored)
    .input('slot', sql.Int, slot)
    .input('oldItems', sql.VarBinary(1920), oldItems)
    .input('newItems', sql.VarBinary(1920), newItems)
    .execute('dbo.WebMarket_Return');
  return execResult(result);
}

async function renewListing({ listingId, accountId }) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('listingId', sql.BigInt, listingId)
    .input('account', sql.VarChar(10), accountId)
    .execute('dbo.WebMarket_Renew');
  return execResult(result);
}

// Colunas públicas de um anúncio (sem conta nem nome do vendedor: anônimo).
const PUBLIC_COLUMNS_SQL = `
  Id AS id, ItemBytes AS itemBytes, ItemGroup AS itemGroup, ItemIndex AS itemIndex,
  ItemName AS itemName, Category AS category, ItemLevel AS itemLevel,
  ExcCount AS excCount, HasSkill AS hasSkill, HasLuck AS hasLuck, AddOption AS addOption,
  Width AS width, Height AS height, Price AS price, CreatedAt AS createdAt, ExpiresAt AS expiresAt
`;

const SORTS = {
  price_asc: 'Price ASC, Id ASC',
  price_desc: 'Price DESC, Id DESC',
  newest: 'CreatedAt DESC, Id DESC',
  level_desc: 'ItemLevel DESC, ExcCount DESC, Price ASC, Id ASC',
  exc_desc: 'ExcCount DESC, ItemLevel DESC, Price ASC, Id ASC',
};

function bindSearchFilters(request, filters) {
  const where = ["Status = 'active'", 'ExpiresAt > SYSUTCDATETIME()'];
  const list = (prefix, values, type) =>
    values.map((value, i) => {
      request.input(`${prefix}${i}`, type, value);
      return `@${prefix}${i}`;
    });

  if (filters.categories && filters.categories.length) {
    where.push(`Category IN (${list('cat', filters.categories, sql.VarChar(20)).join(', ')})`);
  }
  if (filters.types) {
    where.push(filters.types.length ? `(ItemGroup * 512 + ItemIndex) IN (${list('type', filters.types, sql.Int).join(', ')})` : '1 = 0');
  }
  if (filters.itemGroup !== undefined) {
    request.input('itemGroup', sql.TinyInt, filters.itemGroup);
    where.push('ItemGroup = @itemGroup');
  }
  if (filters.itemIndex !== undefined) {
    request.input('itemIndex', sql.SmallInt, filters.itemIndex);
    where.push('ItemIndex = @itemIndex');
  }
  if (filters.minLevel !== undefined) {
    request.input('minLevel', sql.TinyInt, filters.minLevel);
    where.push('ItemLevel >= @minLevel');
  }
  if (filters.minExc !== undefined) {
    request.input('minExc', sql.TinyInt, filters.minExc);
    where.push('ExcCount >= @minExc');
  }
  if (filters.skill) where.push('HasSkill = 1');
  if (filters.luck) where.push('HasLuck = 1');
  if (filters.minPrice !== undefined) {
    request.input('minPrice', sql.Int, filters.minPrice);
    where.push('Price >= @minPrice');
  }
  if (filters.maxPrice !== undefined) {
    request.input('maxPrice', sql.Int, filters.maxPrice);
    where.push('Price <= @maxPrice');
  }
  if (filters.q) {
    // Curingas do LIKE escapados: o texto do usuário é só texto.
    request.input('q', sql.VarChar(110), `%${filters.q.replace(/[[\]%_]/g, '[$&]')}%`);
    where.push('ItemName LIKE @q');
  }
  return where.join(' AND ');
}

/**
 * Busca de anúncios ativos (não expirados). `types` (lista de
 * grupo*512+índice, vinda do catálogo, nunca do usuário) restringe a itens
 * específicos — usado pelo filtro de classe. Cada valor vira um parâmetro.
 */
async function searchListings(filters, { page, limit, sort }) {
  const pool = getPool();

  const countRequest = pool.request();
  const countWhere = bindSearchFilters(countRequest, filters);
  const count = await countRequest.query(`SELECT COUNT(*) AS total FROM WebMarketListings WHERE ${countWhere}`);

  const pageRequest = pool.request();
  const pageWhere = bindSearchFilters(pageRequest, filters);
  pageRequest.input('firstRow', sql.Int, (page - 1) * limit + 1);
  pageRequest.input('lastRow', sql.Int, page * limit);
  const rows = await pageRequest.query(`
    SELECT * FROM (
      SELECT ${PUBLIC_COLUMNS_SQL}, ROW_NUMBER() OVER (ORDER BY ${SORTS[sort] || SORTS.newest}) AS rowNum
      FROM WebMarketListings
      WHERE ${pageWhere}
    ) t
    WHERE rowNum BETWEEN @firstRow AND @lastRow
    ORDER BY rowNum
  `);

  return { total: count.recordset[0].total, rows: rows.recordset };
}

async function findListingById(listingId) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, listingId)
    .query(`
      SELECT ${PUBLIC_COLUMNS_SQL}, SellerAccount AS sellerAccount, Status AS status,
             CASE WHEN ExpiresAt > SYSUTCDATETIME() THEN 0 ELSE 1 END AS expired
      FROM WebMarketListings WHERE Id = @id
    `);
  return result.recordset[0] || null;
}

const MINE_STATE_SQL = `
  CASE WHEN Status = 'active' AND ExpiresAt <= SYSUTCDATETIME() THEN 'expired' ELSE Status END
`;

/** Anúncios da conta (vendedor): ativos, expirados, vendidos e retirados. */
async function findBySeller(accountId, { state, page, limit }) {
  const pool = getPool();
  const request = pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('firstRow', sql.Int, (page - 1) * limit + 1)
    .input('lastRow', sql.Int, page * limit);
  let stateFilter = '';
  if (state) {
    request.input('state', sql.VarChar(10), state);
    stateFilter = `AND ${MINE_STATE_SQL} = @state`;
  }
  const result = await request.query(`
    SELECT * FROM (
      SELECT ${PUBLIC_COLUMNS_SQL}, ${MINE_STATE_SQL} AS state, ClosedAt AS closedAt,
             BuyerName AS buyerName, SellerReceived AS sellerReceived, Fee AS fee,
             SourceVault AS sourceVault, DestVault AS destVault,
             COUNT(*) OVER () AS total,
             ROW_NUMBER() OVER (ORDER BY CASE WHEN Status = 'active' THEN 0 ELSE 1 END, ISNULL(ClosedAt, CreatedAt) DESC, Id DESC) AS rowNum
      FROM WebMarketListings
      WHERE SellerAccount = @accountId ${stateFilter}
    ) t
    WHERE rowNum BETWEEN @firstRow AND @lastRow
    ORDER BY rowNum
  `);
  return result.recordset;
}

/** Quantos anúncios ativos (inclui expirados não resgatados) a conta tem — o limite é 10. */
async function countActiveBySeller(accountId) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .query("SELECT COUNT(*) AS total FROM WebMarketListings WHERE SellerAccount = @accountId AND Status = 'active'");
  return result.recordset[0].total;
}

/** Compras da conta. O nome do vendedor aparece aqui (só depois da venda). */
async function findByBuyer(accountId, { page, limit }) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('firstRow', sql.Int, (page - 1) * limit + 1)
    .input('lastRow', sql.Int, page * limit)
    .query(`
      SELECT * FROM (
        SELECT ${PUBLIC_COLUMNS_SQL}, ClosedAt AS closedAt, SellerName AS sellerName, DestVault AS destVault,
               COUNT(*) OVER () AS total,
               ROW_NUMBER() OVER (ORDER BY ClosedAt DESC, Id DESC) AS rowNum
        FROM WebMarketListings
        WHERE BuyerAccount = @accountId AND Status = 'sold'
      ) t
      WHERE rowNum BETWEEN @firstRow AND @lastRow
      ORDER BY rowNum
    `);
  return result.recordset;
}

/**
 * Admin: seriais (≠ 0) que aparecem em mais de um anúncio. `activeCount > 1`
 * = o mesmo serial anunciado duas vezes ao mesmo tempo (suspeita de dupe).
 * Revender um item comprado ou anunciar de novo depois de retirar também
 * repete o serial — isso é normal.
 */
async function findRepeatedSerials() {
  const pool = getPool();
  const groups = await pool
    .request()
    .query(`
      SELECT TOP 100
        ItemSerial AS serial,
        COUNT(*) AS listings,
        SUM(CASE WHEN Status = 'active' THEN 1 ELSE 0 END) AS activeCount,
        COUNT(DISTINCT SellerAccount) AS sellers,
        MAX(CreatedAt) AS lastListedAt
      FROM WebMarketListings
      WHERE ItemSerial <> 0
      GROUP BY ItemSerial
      HAVING COUNT(*) > 1
      ORDER BY SUM(CASE WHEN Status = 'active' THEN 1 ELSE 0 END) DESC, MAX(CreatedAt) DESC
    `);
  if (groups.recordset.length === 0) return [];

  const request = pool.request();
  const names = groups.recordset.map((g, i) => {
    request.input(`s${i}`, sql.BigInt, g.serial);
    return `@s${i}`;
  });
  const rows = await request.query(`
    SELECT Id AS id, ItemSerial AS serial, ItemName AS itemName, SellerAccount AS sellerAccount,
           BuyerAccount AS buyerAccount, Price AS price, ${MINE_STATE_SQL} AS state,
           CreatedAt AS createdAt, ClosedAt AS closedAt
    FROM WebMarketListings
    WHERE ItemSerial IN (${names.join(', ')})
    ORDER BY ItemSerial, CreatedAt
  `);

  return groups.recordset.map((g) => ({
    ...g,
    serial: Number(g.serial),
    entries: rows.recordset.filter((r) => Number(r.serial) === Number(g.serial)).map(({ serial, ...r }) => r),
  }));
}

module.exports = {
  listVaults,
  findVault,
  createListing,
  buyListing,
  returnListing,
  renewListing,
  searchListings,
  findListingById,
  findBySeller,
  countActiveBySeller,
  findByBuyer,
  findRepeatedSerials,
};
