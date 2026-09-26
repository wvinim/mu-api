/**
 * Confere se o registro DKIM publicado no DNS corresponde à chave privada
 * configurada no .env (DKIM_DOMAIN / DKIM_SELECTOR / DKIM_PRIVATE_KEY_PATH).
 * Só leitura: consulta DNS e lê o arquivo da chave. Não envia e-mail.
 *
 * Uso: node scripts/checkDkim.js
 */
require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns').promises;

async function main() {
  const domain = process.env.DKIM_DOMAIN;
  const selector = process.env.DKIM_SELECTOR;
  const keyPath = process.env.DKIM_PRIVATE_KEY_PATH;
  if (!domain || !selector || !keyPath) {
    console.error('Preencha DKIM_DOMAIN, DKIM_SELECTOR e DKIM_PRIVATE_KEY_PATH no .env');
    process.exitCode = 1;
    return;
  }

  const expected = crypto
    .createPublicKey(fs.readFileSync(keyPath, 'utf8'))
    .export({ type: 'spki', format: 'der' })
    .toString('base64');

  const name = `${selector}._domainkey.${domain}`;
  let records;
  try {
    records = await dns.resolveTxt(name);
  } catch (err) {
    console.error(`Nenhum TXT encontrado em ${name} (${err.code}). Publicou no DNS? Aguarde a propagação.`);
    process.exitCode = 1;
    return;
  }

  // TXT longos chegam quebrados em pedaços de até 255 chars — junta antes de comparar.
  const values = records.map((chunks) => chunks.join(''));
  const published = values
    .map((v) => /(?:^|;)\s*p=([A-Za-z0-9+/=\s]+)/.exec(v))
    .filter(Boolean)
    .map((m) => m[1].replace(/\s+/g, ''));

  if (published.includes(expected)) {
    console.log(`OK: ${name} publica a chave pública correspondente à chave privada configurada.`);
  } else {
    console.error(`DIVERGENTE: ${name} existe, mas a chave publicada não bate com a chave privada.`);
    console.error('Publicado:', values);
    process.exitCode = 1;
  }
}

main();
