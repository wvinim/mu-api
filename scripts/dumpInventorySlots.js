/**
 * Ferramenta de diagnóstico (só leitura) recomendada em
 * docs/INVENTORY_BYTE_FORMAT.md — dump legível dos slots ocupados do
 * Inventory de um personagem + status de ConnectStat da conta dona, para
 * investigar discrepâncias entre o que a API gravou e o que o client
 * mostra no jogo.
 *
 * Ciente do footprint 2D real de cada item (largura/altura vindas de
 * src/data/itemDimensions.json — ver docs/SECTION_5_SHOP.md, bug de
 * itens 2x2+ "escondendo" células vizinhas): marca slots que estão
 * vazios no array mas cobertos pelo footprint de um item maior vizinho
 * como "coberto", não como "livre".
 *
 * Uso: node scripts/dumpInventorySlots.js <NomeDoPersonagem>
 */
require('dotenv').config();
const { connectDB, getPool, sql, closeDB } = require('../src/db/pool');
const inventoryService = require('../src/services/inventoryService');

async function main() {
  const characterName = process.argv[2];
  if (!characterName) {
    console.error('Uso: node scripts/dumpInventorySlots.js <NomeDoPersonagem>');
    process.exitCode = 1;
    return;
  }

  await connectDB();
  const pool = getPool();

  const charResult = await pool
    .request()
    .input('name', sql.VarChar(10), characterName)
    .query('SELECT Inventory, AccountID FROM Character WHERE Name = @name');

  const row = charResult.recordset[0];
  if (!row) {
    console.error(`Personagem "${characterName}" não encontrado.`);
    await closeDB();
    process.exitCode = 1;
    return;
  }

  const buffer = row.Inventory;
  const expectedLength = inventoryService.ITEM_DB_BYTE * inventoryService.INVENTORY_SIZE;
  console.log(`Conta dona: ${row.AccountID}`);
  console.log(`DATALENGTH(Inventory): ${buffer.length} bytes (esperado ${expectedLength})`);
  if (buffer.length !== expectedLength) {
    console.log('⚠️  Tamanho do buffer não bate com o esperado — formato pode ter mudado.');
  }

  const statusResult = await pool
    .request()
    .input('accountId', sql.VarChar(10), row.AccountID)
    .query('SELECT ConnectStat, ConnectTM FROM MEMB_STAT WHERE memb___id = @accountId');
  const status = statusResult.recordset[0];
  console.log(
    `MEMB_STAT: ${status ? `ConnectStat=${status.ConnectStat}, ConnectTM=${status.ConnectTM}` : '(sem linha em MEMB_STAT para esta conta)'}`,
  );

  console.log('\nSlot | Faixa                    | Status  | Hex / item');
  for (let n = 0; n < inventoryService.INVENTORY_SIZE; n++) {
    const offset = n * inventoryService.ITEM_DB_BYTE;
    const slot = buffer.subarray(offset, offset + inventoryService.ITEM_DB_BYTE);
    const empty = inventoryService.isSlotEmpty(slot);
    const inBag = n >= inventoryService.BAG_START_SLOT && n < inventoryService.BAG_END_SLOT;
    if (!empty) {
      const faixa = n < 12 ? 'equipamento (0-11)' : inBag ? 'mochila (12-75)' : 'desconhecida (76-107)';
      let info = slot.toString('hex');
      if (inBag) {
        const type = inventoryService.decodeItemType(slot);
        const itemGroup = Math.floor(type / 512);
        const itemIndex = type % 512;
        const dims = inventoryService.getItemDimensions(itemGroup, itemIndex);
        info += dims ? `  (${itemGroup}:${itemIndex} "${dims.name}" ${dims.width}x${dims.height})` : `  (${itemGroup}:${itemIndex} — NÃO ENCONTRADO na tabela de dimensões)`;
      }
      console.log(`${String(n).padStart(3)}  | ${faixa.padEnd(25)}| OCUPADO | ${info}`);
    }
  }

  let freeInBag = 0;
  let unknownItems = [];
  try {
    const grid = inventoryService.buildBagGrid(buffer);
    unknownItems = grid.unknownItems;
    freeInBag = grid.occupied.filter((cell) => !cell).length;
  } catch (err) {
    console.log(`\n⚠️  Não foi possível calcular a grade 2D: ${err.message}`);
  }

  console.log(`\nCélulas livres na mochila considerando footprint real (8x8): ${freeInBag}`);
  if (unknownItems.length > 0) {
    console.log(`⚠️  Itens fora da tabela de dimensões (footprint desconhecido): ${JSON.stringify(unknownItems)}`);
  }

  await closeDB();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
