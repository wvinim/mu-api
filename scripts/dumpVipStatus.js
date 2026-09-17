/**
 * Ferramenta de diagnóstico (só leitura) para validar manualmente o fluxo
 * de VIP (ver docs/SECTION_9_VIP.md) sem precisar escrever SQL na hora:
 * mostra Cash/Vip/VipStartDate/VipEndDate de MEMB_INFO e as linhas atuais
 * de MEMB_AUTOPICK_ITEMS para a conta.
 *
 * Uso: node scripts/dumpVipStatus.js <username>
 */
require('dotenv').config();
const { connectDB, getPool, sql, closeDB } = require('../src/db/pool');
const vipAutopickCatalog = require('../src/services/vipAutopickCatalog');

const TIER_NAMES = { 0: 'Nenhum', 1: 'Vip', 2: 'Super Vip', 3: 'Mega Vip' };

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Uso: node scripts/dumpVipStatus.js <username>');
    process.exitCode = 1;
    return;
  }

  await connectDB();
  const pool = getPool();

  const accountResult = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .query('SELECT memb___id AS username, Cash AS cash, Vip AS vip, VipStartDate AS vipStartDate, VipEndDate AS vipEndDate FROM MEMB_INFO WHERE memb___id = @username');

  const account = accountResult.recordset[0];
  if (!account) {
    console.error(`Conta "${username}" não encontrada.`);
    await closeDB();
    process.exitCode = 1;
    return;
  }

  const tierName = TIER_NAMES[account.vip] ?? `desconhecido (${account.vip})`;
  console.log(`Conta: ${account.username}`);
  console.log(`Cash: ${account.cash}`);
  console.log(`Vip: ${account.vip} (${tierName})`);
  console.log(`VipStartDate: ${account.vipStartDate ?? '(null)'}`);
  console.log(`VipEndDate: ${account.vipEndDate ?? '(null)'}`);
  if (account.vipEndDate) {
    const active = new Date(account.vipEndDate) > new Date();
    console.log(`Status: ${active ? 'ATIVO' : 'EXPIRADO'}`);
  }

  const autopickResult = await pool
    .request()
    .input('username', sql.VarChar(10), username)
    .query('SELECT ItemGroup, ItemIndex, ItemLevel FROM MEMB_AUTOPICK_ITEMS WHERE AccountID = @username');

  console.log(`\nMEMB_AUTOPICK_ITEMS (${autopickResult.recordset.length} linha(s)):`);
  if (autopickResult.recordset.length === 0) {
    console.log('  (vazio)');
  }
  for (const row of autopickResult.recordset) {
    const option = vipAutopickCatalog.findOption(row.ItemGroup, row.ItemIndex, row.ItemLevel);
    console.log(`  group=${row.ItemGroup} index=${row.ItemIndex} level=${row.ItemLevel}  ${option ? `"${option.name}"` : '(fora do catálogo de autopick conhecido)'}`);
  }

  await closeDB();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
