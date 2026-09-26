/**
 * Gera o par de chaves RSA 2048 usado na assinatura DKIM feita pela API
 * (ver docs/EMAIL_DKIM.md). Não toca no banco nem na rede.
 *
 * - Grava a chave PRIVADA no caminho informado (nunca versionar).
 * - Imprime o registro TXT (nome + valor) a publicar no DNS (GoDaddy).
 *
 * Uso: node scripts/generateDkimKey.js [caminho-da-chave] [seletor]
 *   padrão: secrets/dkim-api.pem, seletor "api"
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function main() {
  const keyPath = path.resolve(process.argv[2] || 'secrets/dkim-api.pem');
  const selector = process.argv[3] || 'api';

  if (fs.existsSync(keyPath)) {
    // Sobrescrever invalidaria o TXT já publicado — obriga a apagar à mão.
    console.error(`Já existe uma chave em ${keyPath}. Apague-a manualmente se quiser gerar outra.`);
    process.exitCode = 1;
    return;
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });

  console.log(`Chave privada gravada em: ${keyPath}`);
  console.log('');
  console.log('Registro TXT a criar no DNS:');
  console.log(`  Nome : ${selector}._domainkey`);
  console.log(`  Valor: v=DKIM1; k=rsa; p=${publicKey.toString('base64')}`);
  console.log('');
  console.log('No .env do servidor:');
  console.log('  DKIM_DOMAIN=mupro.vip');
  console.log(`  DKIM_SELECTOR=${selector}`);
  console.log(`  DKIM_PRIVATE_KEY_PATH=${keyPath}`);
}

main();
