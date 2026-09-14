const path = require('path');
const EfiPay = require('sdk-node-apis-efi');

const env = require('../config/env');
const AppError = require('../utils/AppError');

let client = null;

function isConfigured() {
  return Boolean(env.efi.clientId && env.efi.clientSecret && env.efi.certificatePath && env.efi.pixKey);
}

function getClient() {
  if (!isConfigured()) return null;
  if (!client) {
    client = new EfiPay({
      client_id: env.efi.clientId,
      client_secret: env.efi.clientSecret,
      certificate: path.resolve(env.efi.certificatePath),
      sandbox: env.efi.sandbox,
      cache: true,
    });
  }
  return client;
}

function requireClient() {
  const efi = getClient();
  if (!efi) {
    throw new AppError(503, 'EFI_NOT_CONFIGURED', 'Pagamento via Pix ainda não está configurado nesta API.');
  }
  return efi;
}

/**
 * Cria uma cobrança Pix imediata e já gera o QR Code/copia-e-cola a
 * partir do location retornado. Não envia `devedor` (CPF/nome) — não
 * coletamos isso no cadastro do site; é opcional na API da Efí.
 */
async function createImmediateCharge({ amountCents, description }) {
  const efi = requireClient();

  const charge = await efi.pixCreateImmediateCharge({
    calendario: { expiracao: env.efi.chargeExpirationSeconds },
    valor: { original: (amountCents / 100).toFixed(2) },
    chave: env.efi.pixKey,
    solicitacaoPagador: description,
  });

  let pixCopiaECola = null;
  let qrCodeImage = null;
  if (charge.loc?.id) {
    const qrcode = await efi.pixGenerateQRCode({ id: charge.loc.id });
    pixCopiaECola = qrcode.qrcode || null;
    qrCodeImage = qrcode.imagemQrcode || null;
  }

  return { txid: charge.txid, status: charge.status, pixCopiaECola, qrCodeImage };
}

/**
 * Reconsulta uma cobrança direto na API da Efí. Usado sempre que
 * recebemos um webhook — nunca confiamos no payload do webhook sozinho
 * para decidir se um pagamento foi confirmado (ver docs/SECTION_5_SHOP.md).
 */
async function getChargeStatus(txid) {
  const efi = requireClient();
  return efi.pixDetailCharge({ txid });
}

async function configureWebhook(webhookUrl) {
  const efi = requireClient();
  return efi.pixConfigWebhook({ chave: env.efi.pixKey }, { webhookUrl });
}

module.exports = { isConfigured, createImmediateCharge, getChargeStatus, configureWebhook };
