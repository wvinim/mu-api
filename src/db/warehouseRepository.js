const { getPool, sql } = require('./pool');
const warehouseService = require('../services/warehouseService');

// Só usado como valor da linha NOVA quando a conta não tem nenhuma
// (confirmado com o usuário). NUNCA usado pra filtrar a checagem de
// existência — ver bug corrigido abaixo.
const DEFAULT_VAULT_ID = 0;

/**
 * Garante que a conta tem uma linha em `warehouse` (o gameserver normalmente
 * cria isso no primeiro login/abertura do baú — mas um jogador pode comprar
 * na loja antes disso) e devolve `{ items, vaultId }` pra uso imediato.
 *
 * BUG CORRIGIDO (2026-09-17): a checagem de existência filtrava também por
 * `VaultID = 0`. Se a conta já tivesse uma linha com outro `VaultID`, o
 * código concluía "não existe linha" e inseria uma SEGUNDA linha pra mesma
 * conta (duplicata). A checagem correta é só por `AccountID` — só insere
 * se não existir NENHUMA linha pra conta, e usa o `VaultID` real da linha
 * encontrada nas operações seguintes (não presume 0).
 *
 * A tabela `warehouse` NÃO tem PK/índice único declarado (confirmado via
 * sys.indexes) — por isso o SELECT de checagem usa `UPDLOCK, HOLDLOCK`
 * dentro de uma transação, pra evitar que duas requisições concorrentes
 * criem duas linhas pra mesma conta (não temos uma constraint do banco
 * pra confiar). Valores padrão da linha nova confirmados com o usuário:
 * DbVersion=3, pw=0, VaultID=0, Money=0, EndUseDate=NULL, Number=NULL.
 */
async function ensureRowAndGetItems(accountId) {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const existing = await new sql.Request(transaction)
      .input('accountId', sql.VarChar(10), accountId)
      .query('SELECT TOP 1 Items, VaultID FROM warehouse WITH (UPDLOCK, HOLDLOCK) WHERE AccountID = @accountId');

    if (existing.recordset.length > 0) {
      await transaction.commit();
      return { items: existing.recordset[0].Items, vaultId: existing.recordset[0].VaultID };
    }

    const emptyItems = warehouseService.emptyItemsBuffer();
    await new sql.Request(transaction)
      .input('accountId', sql.VarChar(10), accountId)
      .input('vaultId', sql.Int, DEFAULT_VAULT_ID)
      .input('items', sql.VarBinary(1920), emptyItems)
      .query(`
        INSERT INTO warehouse (AccountID, Items, Money, EndUseDate, DbVersion, pw, VaultID, Number)
        VALUES (@accountId, @items, 0, NULL, 3, 0, @vaultId, NULL)
      `);

    await transaction.commit();
    return { items: emptyItems, vaultId: DEFAULT_VAULT_ID };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function updateItems(accountId, vaultId, itemsBuffer) {
  const pool = getPool();
  await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('vaultId', sql.Int, vaultId)
    .input('items', sql.VarBinary(1920), itemsBuffer)
    .query('UPDATE warehouse SET Items = @items WHERE AccountID = @accountId AND VaultID = @vaultId');
}

module.exports = { ensureRowAndGetItems, updateItems };
