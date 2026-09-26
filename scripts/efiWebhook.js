/**
 * Cadastra/consulta o webhook Pix da chave EFI_PIX_KEY na Efí, usando as
 * credenciais do .env (homologação ou produção, conforme EFI_SANDBOX).
 * Não toca no banco.
 *
 * Uso:
 *   node scripts/efiWebhook.js show
 *   node scripts/efiWebhook.js register https://api.mupro.vip [--skip-mtls]
 *
 * A URL cadastrada é <base>/api/v1/shop/payment/webhook/<EFI_WEBHOOK_SECRET>.
 * Ao cadastrar, a Efí manda uma notificação de teste para essa URL e só
 * aceita se receber 200 — com mTLS, o nginx precisa estar pedindo o
 * certificado da Efí (ver docs/SECTION_5_SHOP.md). --skip-mtls desliga essa
 * exigência (só para diagnóstico).
 */
require('dotenv').config();
const env = require('../src/config/env');
const efiClient = require('../src/services/efiClient');

function mask(url) {
  return env.efi.webhookSecret ? url.replace(env.efi.webhookSecret, `${env.efi.webhookSecret.slice(0, 4)}…`) : url;
}

async function main() {
  const [command, baseUrl] = process.argv.slice(2);
  const ambiente = env.efi.sandbox ? 'HOMOLOGAÇÃO' : 'PRODUÇÃO';
  console.log(`Ambiente Efí: ${ambiente} | chave Pix: ${env.efi.pixKey || '(vazia)'}\n`);

  if (command === 'show') {
    const webhook = await efiClient.getWebhook();
    console.log(JSON.stringify({ ...webhook, webhookUrl: mask(webhook.webhookUrl || '') }, null, 2));
    return;
  }

  if (command === 'register' && baseUrl) {
    if (!env.efi.webhookSecret) throw new Error('EFI_WEBHOOK_SECRET vazio no .env');
    const skipMtls = process.argv.includes('--skip-mtls');
    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/shop/payment/webhook/${env.efi.webhookSecret}`;
    console.log(`Cadastrando ${mask(url)}${skipMtls ? ' (SEM mTLS)' : ''}...`);
    await efiClient.configureWebhook(url, { skipMtls });
    console.log('OK — a Efí validou a URL (a notificação de teste recebeu 200).');
    return;
  }

  console.error('Uso: node scripts/efiWebhook.js show | register <https://base-da-api> [--skip-mtls]');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('\nFALHOU:', err instanceof Error ? err.message : JSON.stringify(err, null, 2));
  process.exitCode = 1;
});
