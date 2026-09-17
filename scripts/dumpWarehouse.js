/**
 * Ferramenta de diagnóstico (SÓ LEITURA) — investigação do formato da
 * tabela `warehouse` (baú da conta), NUNCA validado nesta API até agora
 * (diferente de `Character.Inventory`, documentado em
 * docs/INVENTORY_BYTE_FORMAT.md). Não escreva nada baseado neste script
 * sem antes comparar um dump ANTES/DEPOIS de depositar um item real no
 * baú pelo client do jogo, na mesma conta de teste.
 *
 * Uso:
 *   node scripts/dumpWarehouse.js --schema           # PK/índices da tabela
 *   node scripts/dumpWarehouse.js <AccountID>         # linha(s) da conta
 */
require('dotenv').config();
const { connectDB, getPool, sql, closeDB } = require('../src/db/pool');

// Mesmo critério de "slot vazio" documentado em docs/INVENTORY_BYTE_FORMAT.md
// para Character.Inventory — aplicado aqui só como HIPÓTESE a confirmar,
// não como fato: o layout de 16 bytes/slot do warehouse pode ser
// diferente (offsets, ou até um tamanho de slot diferente).
const ASSUMED_ITEM_DB_BYTE = 16;

function isSlotEmptyGuess(slotBytes) {
  const byte0 = slotBytes[0];
  const byte7 = slotBytes[7];
  const byte9 = slotBytes[9];
  return byte0 === 0xff && (byte7 & 0x80) === 0x80 && (byte9 & 0xf0) === 0xf0;
}

async function dumpSchema(pool) {
  const columns = await pool.request().query(`
    SELECT c.name, t.name AS type, c.max_length, c.is_nullable
    FROM sys.columns c
    JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.warehouse')
    ORDER BY c.column_id
  `);
  console.log('Colunas:');
  for (const col of columns.recordset) {
    console.log(`  ${col.name.padEnd(15)} ${col.type}(${col.max_length})${col.is_nullable ? ' NULL' : ' NOT NULL'}`);
  }

  const keys = await pool.request().query(`
    SELECT i.name AS indexName, i.is_primary_key, i.is_unique, COL_NAME(ic.object_id, ic.column_id) AS colName, ic.key_ordinal
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    WHERE i.object_id = OBJECT_ID(N'dbo.warehouse')
    ORDER BY i.index_id, ic.key_ordinal
  `);
  console.log('\nÍndices/chaves:');
  if (keys.recordset.length === 0) console.log('  (nenhum índice encontrado)');
  for (const k of keys.recordset) {
    console.log(`  ${k.indexName} ${k.is_primary_key ? '[PK]' : k.is_unique ? '[UNIQUE]' : ''} col=${k.colName} ordinal=${k.key_ordinal}`);
  }

  const counts = await pool.request().query(`
    SELECT COUNT(*) AS totalRows, COUNT(DISTINCT AccountID) AS distinctAccounts,
           MIN(VaultID) AS minVaultId, MAX(VaultID) AS maxVaultId,
           MIN(Number) AS minNumber, MAX(Number) AS maxNumber
    FROM dbo.warehouse
  `);
  console.log('\nEstatísticas gerais (sem expor dados de conta específica):');
  console.log(counts.recordset[0]);
}

async function dumpAccount(pool, accountId) {
  const result = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .query('SELECT AccountID, Items, Money, EndUseDate, DbVersion, pw, VaultID, Number FROM dbo.warehouse WHERE AccountID = @accountId ORDER BY VaultID');

  if (result.recordset.length === 0) {
    console.log(`Nenhuma linha em warehouse para AccountID="${accountId}".`);
    return;
  }

  for (const row of result.recordset) {
    console.log(`\n=== VaultID=${row.VaultID} Number=${row.Number} ===`);
    console.log(`Money: ${row.Money}`);
    console.log(`EndUseDate: ${row.EndUseDate}`);
    console.log(`DbVersion: ${row.DbVersion}`);
    console.log(`pw: ${row.pw}`);

    const buffer = row.Items;
    if (!buffer) {
      console.log('Items: NULL');
      continue;
    }
    console.log(`DATALENGTH(Items): ${buffer.length} bytes`);
    if (buffer.length % ASSUMED_ITEM_DB_BYTE !== 0) {
      console.log(`⚠️  Tamanho não é múltiplo de ${ASSUMED_ITEM_DB_BYTE} — a hipótese de 16 bytes/slot pode estar errada.`);
    }
    const slotCount = Math.floor(buffer.length / ASSUMED_ITEM_DB_BYTE);
    console.log(`Slots (assumindo ${ASSUMED_ITEM_DB_BYTE} bytes/slot, NÃO CONFIRMADO): ${slotCount}`);

    console.log('\nSlot | Status (heurística não confirmada) | Hex');
    for (let n = 0; n < slotCount; n++) {
      const offset = n * ASSUMED_ITEM_DB_BYTE;
      const slot = buffer.subarray(offset, offset + ASSUMED_ITEM_DB_BYTE);
      const emptyGuess = isSlotEmptyGuess(slot);
      if (!emptyGuess) {
        console.log(`${String(n).padStart(3)}  | possivelmente OCUPADO              | ${slot.toString('hex')}`);
      }
    }
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Uso: node scripts/dumpWarehouse.js --schema | <AccountID>');
    process.exitCode = 1;
    return;
  }

  await connectDB();
  const pool = getPool();

  if (arg === '--schema') {
    await dumpSchema(pool);
  } else {
    await dumpAccount(pool, arg);
  }

  await closeDB();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
