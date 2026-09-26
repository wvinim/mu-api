/**
 * Ferramenta de diagnóstico (só leitura): lista e-mails usados por mais de
 * uma conta em MEMB_INFO, e mostra a collation de mail_addr (define se a
 * comparação de e-mail no registro diferencia maiúsculas/minúsculas).
 *
 * O registro passou a recusar e-mail duplicado, mas contas criadas antes
 * disso podem já compartilhar e-mail — nesses casos o forgot-password não
 * envia nada (ambiguidade). Resolver caso a caso, à mão.
 *
 * Uso: node scripts/dumpDuplicateEmails.js
 */
require('dotenv').config();
const { connectDB, getPool, closeDB } = require('../src/db/pool');

async function main() {
  await connectDB();
  const pool = getPool();

  const collation = await pool.request().query(`
    SELECT c.collation_name AS collation
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID('MEMB_INFO') AND c.name = 'mail_addr'
  `);
  const name = collation.recordset[0]?.collation;
  console.log(`Collation de MEMB_INFO.mail_addr: ${name} (${/_CI_/.test(name) ? 'NÃO diferencia maiúsculas — ok' : 'DIFERENCIA maiúsculas — avise no chat'})`);
  console.log('');

  // Agrupa ignorando maiúsculas e espaços, para pegar também variações.
  const dupes = await pool.request().query(`
    SELECT
      LOWER(LTRIM(RTRIM(mail_addr))) AS email,
      memb___id AS username,
      mail_addr AS storedEmail,
      mail_chek AS emailConfirmed,
      appl_days AS createdAt
    FROM MEMB_INFO
    WHERE LOWER(LTRIM(RTRIM(mail_addr))) IN (
      SELECT LOWER(LTRIM(RTRIM(mail_addr)))
      FROM MEMB_INFO
      WHERE mail_addr IS NOT NULL AND LTRIM(RTRIM(mail_addr)) <> ''
      GROUP BY LOWER(LTRIM(RTRIM(mail_addr)))
      HAVING COUNT(*) > 1
    )
    ORDER BY email, appl_days
  `);

  if (dupes.recordset.length === 0) {
    console.log('Nenhum e-mail compartilhado entre contas.');
    return;
  }

  const groups = new Set(dupes.recordset.map((r) => r.email));
  console.log(`${groups.size} e-mail(s) compartilhado(s) por ${dupes.recordset.length} contas:`);
  console.table(dupes.recordset);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDB());
