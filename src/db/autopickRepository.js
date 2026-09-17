const { getPool, sql } = require('./pool');

/**
 * Tabela MEMB_AUTOPICK_ITEMS já existe em produção (criada fora desta API
 * — ver docs/VIP_SYSTEM.md pelo schema exato). Colunas em PascalCase com
 * "AccountID" (I maiúsculo no fim), diferente do padrão AccountId usado
 * nas nossas próprias tabelas — mantenha esse nome exato nas queries.
 */
async function findByAccount(accountId) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .query('SELECT ItemGroup, ItemIndex, ItemLevel FROM MEMB_AUTOPICK_ITEMS WHERE AccountID = @accountId');
  return result.recordset;
}

/**
 * Substitui a seleção inteira (delete + reinsert) — mesmo padrão já usado
 * em WebShopBundleItems: mais simples e previsível pro usuário editar do
 * que tentar diff/merge da lista anterior.
 */
async function replaceAll(accountId, items) {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('accountId', sql.VarChar(10), accountId)
      .query('DELETE FROM MEMB_AUTOPICK_ITEMS WHERE AccountID = @accountId');

    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop -- inserções dependentes, precisam ser sequenciais na mesma transação
      await new sql.Request(transaction)
        .input('accountId', sql.VarChar(10), accountId)
        .input('itemGroup', sql.Int, item.itemGroup)
        .input('itemIndex', sql.Int, item.itemIndex)
        .input('itemLevel', sql.Int, item.itemLevel)
        .query(`
          INSERT INTO MEMB_AUTOPICK_ITEMS (AccountID, ItemGroup, ItemIndex, ItemLevel)
          VALUES (@accountId, @itemGroup, @itemIndex, @itemLevel)
        `);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

/**
 * Usado na compra do Super Vip: garante que os itens fixos estão
 * presentes, sem apagar uma seleção de Mega Vip que já existisse (ex:
 * conta que já foi Mega Vip antes e comprou Super Vip depois) — só
 * insere o que ainda não está lá, idempotente.
 */
async function ensureItemsExist(accountId, items) {
  const pool = getPool();
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop -- idempotente, uma checagem por item
    await pool
      .request()
      .input('accountId', sql.VarChar(10), accountId)
      .input('itemGroup', sql.Int, item.itemGroup)
      .input('itemIndex', sql.Int, item.itemIndex)
      .input('itemLevel', sql.Int, item.itemLevel)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM MEMB_AUTOPICK_ITEMS
          WHERE AccountID = @accountId AND ItemGroup = @itemGroup AND ItemIndex = @itemIndex AND ItemLevel = @itemLevel
        )
        INSERT INTO MEMB_AUTOPICK_ITEMS (AccountID, ItemGroup, ItemIndex, ItemLevel)
        VALUES (@accountId, @itemGroup, @itemIndex, @itemLevel)
      `);
  }
}

module.exports = { findByAccount, replaceAll, ensureItemsExist };
