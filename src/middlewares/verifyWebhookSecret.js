const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/AppError');

/**
 * Checagem leve de autenticidade do webhook (segredo na URL). NÃO
 * substitui a reconsulta da cobrança direto na API da Efí antes de
 * creditar — é só uma primeira barreira contra chamadas forjadas ao
 * endpoint. A Efí recomenda mTLS/IP allowlist no endpoint do webhook;
 * isso depende da decisão de reverse proxy da etapa de deploy (ver
 * docs/SECTION_5_SHOP.md).
 */
function verifyWebhookSecret(req, res, next) {
  const provided = req.params.secret || '';
  const expected = env.efi.webhookSecret;

  if (!expected) {
    return next(new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'EFI_WEBHOOK_SECRET não configurado.'));
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const matches =
    providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!matches) {
    // 404 em vez de 401/403: não confirma nem nega a existência da rota.
    return next(new AppError(404, 'NOT_FOUND', 'Rota não encontrada.'));
  }

  return next();
}

module.exports = verifyWebhookSecret;
