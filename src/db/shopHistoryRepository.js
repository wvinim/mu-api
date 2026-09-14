const { getPool, sql } = require('./pool');

/**
 * Histórico unificado (compras de crédito + resgates de item) com
 * paginação real sobre o conjunto combinado — não é "página de cada
 * tabela colada", é uma paginação de verdade via UNION ALL + ROW_NUMBER.
 */
async function findByAccount(accountId, { page = 1, limit = 20 } = {}) {
  const pool = getPool();
  const firstRow = (page - 1) * limit + 1;
  const lastRow = page * limit;

  const combinedCte = `
    SELECT
      'credit_purchase' AS type,
      TxId AS reference,
      NULL AS itemName,
      AmountCents AS amountCents,
      CreditsAmount AS creditsAmount,
      NULL AS characterName,
      Status AS status,
      CreatedAt AS createdAt
    FROM WebPixCharges WHERE AccountId = @accountId

    UNION ALL

    SELECT
      'item_redemption' AS type,
      CAST(r.ShopItemId AS VARCHAR(20)) AS reference,
      i.Name AS itemName,
      NULL AS amountCents,
      r.PriceCredits AS creditsAmount,
      r.CharacterName AS characterName,
      'completed' AS status,
      r.CreatedAt AS createdAt
    FROM WebItemRedemptions r
    JOIN WebShopItems i ON i.Id = r.ShopItemId
    WHERE r.AccountId = @accountId
  `;

  const result = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('firstRow', sql.Int, firstRow)
    .input('lastRow', sql.Int, lastRow)
    .query(`
      WITH Combined AS (${combinedCte}),
      Ranked AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY createdAt DESC) AS rank FROM Combined
      )
      SELECT type, reference, itemName, amountCents, creditsAmount, characterName, status, createdAt
      FROM Ranked WHERE rank BETWEEN @firstRow AND @lastRow ORDER BY rank;

      WITH Combined AS (${combinedCte})
      SELECT COUNT(*) AS total FROM Combined;
    `);

  return { items: result.recordsets[0], total: result.recordsets[1][0].total };
}

module.exports = { findByAccount };
