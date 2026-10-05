const { getPool, sql } = require('./pool');
const { SHOWCASE_VAULT_ID } = require('../services/warehouseService');

/**
 * Vitrine do mercado (/mercado no jogo). O site só lê a vitrine GUARDADA,
 * em Extwarehouse — enquanto ela é o baú ativo (warehouse.VaultID = 200)
 * está em edição e não aparece. Ver docs/SECTION_10_MARKET.md.
 *
 * Extwarehouse.AccountID é CHAR(10) com collation diferente de MEMB_INFO,
 * por isso nada aqui faz JOIN entre Extwarehouse e tabelas Web*: cada
 * consulta é por conta, com parâmetro.
 */

async function findContactByCharacter(characterName) {
  const result = await getPool()
    .request()
    .input('name', sql.VarChar(10), characterName)
    .query('SELECT AccountId, CharacterName, UpdatedAt FROM WebShowcaseContact WHERE CharacterName = @name');
  return result.recordset[0] || null;
}

async function findContactByAccount(accountId) {
  const result = await getPool()
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .query('SELECT AccountId, CharacterName, UpdatedAt FROM WebShowcaseContact WHERE AccountId = @accountId');
  return result.recordset[0] || null;
}

/** Vitrine guardada: `{ items, storedAt }` ou null. `storedAt` = quando a MUDAR_BAU guardou o baú. */
async function findStoredShowcase(accountId) {
  const result = await getPool()
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('vaultId', sql.Int, SHOWCASE_VAULT_ID)
    .query('SELECT TOP 1 Items, EndUseDate FROM Extwarehouse WHERE AccountID = @accountId AND VaultID = @vaultId');
  const row = result.recordset[0];
  return row ? { items: row.Items, storedAt: row.EndUseDate } : null;
}

/** VaultID do baú ativo, ou null se a conta nunca abriu o baú. */
async function findActiveVaultId(accountId) {
  const result = await getPool()
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .query('SELECT TOP 1 VaultID FROM warehouse WHERE AccountID = @accountId');
  return result.recordset[0] ? result.recordset[0].VaultID : null;
}

module.exports = { findContactByCharacter, findContactByAccount, findStoredShowcase, findActiveVaultId };
