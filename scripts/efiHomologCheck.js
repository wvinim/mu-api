/**
 * Teste da integração Efí em HOMOLOGAÇÃO, sem tocar no banco de dados.
 *
 * Usa o mesmo src/services/efiClient.js da API (mesmo código que roda em
 * produção) para: autenticar com as credenciais + certificado, criar uma
 * cobrança Pix de R$ 0,01, gerar o QR Code e acompanhar o status até
 * "CONCLUIDA" — em homologação, cobranças de R$ 0,01 a R$ 10,00 são
 * confirmadas automaticamente pela Efí.
 *
 * Recusa rodar se EFI_SANDBOX não for "true": nunca cria cobrança real.
 *
 * Uso:
 *   node scripts/efiHomologCheck.js [--env .env.homolog]           teste completo
 *   node scripts/efiHomologCheck.js [--env .env.homolog] --keys    lista chaves Pix (EVP)
 *   node scripts/efiHomologCheck.js [--env .env.homolog] --create-key
 *       cria uma chave aleatória (EVP) em homologação — use-a em EFI_PIX_KEY
 *   node scripts/efiHomologCheck.js [--env .env.homolog] --webhook  mostra o webhook cadastrado
 */
const path = require('path');
const dotenv = require('dotenv');

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
// Carrega o arquivo escolhido ANTES do src/config/env.js (dotenv não sobrescreve).
dotenv.config({ path: path.resolve(envIdx >= 0 ? args[envIdx + 1] : '.env') });

const EfiPay = require('sdk-node-apis-efi');
const env = require('../src/config/env');
const efiClient = require('../src/services/efiClient');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function rawClient() {
  return new EfiPay({
    client_id: env.efi.clientId,
    client_secret: env.efi.clientSecret,
    certificate: path.resolve(env.efi.certificatePath),
    sandbox: true,
  });
}

function describeError(err) {
  // O SDK devolve o corpo de erro da Efí (objeto), não um Error.
  return typeof err === 'object' ? JSON.stringify(err, null, 2) : String(err);
}

async function fullCheck() {
  if (!efiClient.isConfigured()) {
    throw new Error('Faltam variáveis: EFI_CLIENT_ID, EFI_CLIENT_SECRET, EFI_CERTIFICATE_PATH e EFI_PIX_KEY');
  }

  console.log('1/3 Criando cobrança de R$ 0,01...');
  const charge = await efiClient.createImmediateCharge({ amountCents: 1, description: 'Teste homologacao mu-api' });
  console.log(`    OK  txid=${charge.txid} status=${charge.status}`);
  console.log(`    copia-e-cola: ${charge.pixCopiaECola ? `${charge.pixCopiaECola.length} caracteres` : 'AUSENTE'}`);
  console.log(`    imagem QR:    ${charge.qrCodeImage ? 'ok' : 'AUSENTE'}`);

  console.log('2/3 Aguardando confirmação automática (até 90s)...');
  for (let i = 0; i < 30; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const detail = await efiClient.getChargeStatus(charge.txid);
    if (detail.status === 'CONCLUIDA') {
      console.log(`    OK  CONCLUIDA — pix recebido: ${JSON.stringify(detail.pix || [])}`);
      console.log('3/3 Integração com a Efí (homologação) funcionando.');
      return;
    }
    process.stdout.write(`    status=${detail.status}...\r`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(3000);
  }
  throw new Error(`Cobrança ${charge.txid} não foi confirmada em 90s (pode demorar mais — rode --webhook e confira no painel da Efí)`);
}

async function main() {
  if (!env.efi.sandbox) {
    console.error('Recusado: EFI_SANDBOX não é "true". Este script só roda em homologação.');
    process.exitCode = 1;
    return;
  }
  console.log(`Ambiente: HOMOLOGAÇÃO | certificado: ${env.efi.certificatePath} | chave Pix: ${env.efi.pixKey || '(vazia)'}\n`);

  if (args.includes('--keys')) {
    console.log(JSON.stringify(await rawClient().pixListEvp(), null, 2));
  } else if (args.includes('--create-key')) {
    const created = await rawClient().pixCreateEvp();
    console.log(`Chave criada: ${created.chave}\nColoque em EFI_PIX_KEY no .env de homologação.`);
  } else if (args.includes('--webhook')) {
    console.log(JSON.stringify(await rawClient().pixDetailWebhook({ chave: env.efi.pixKey }), null, 2));
  } else {
    await fullCheck();
  }
}

main().catch((err) => {
  console.error('\nFALHOU:', err instanceof Error ? err.message : describeError(err));
  process.exitCode = 1;
});
