const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/AppError');

/**
 * Valida o header X-Hub-Signature-256 da Meta: "sha256=" + HMAC-SHA256 do
 * corpo bruto com o App Secret. Precisa de req.rawBody (capturado em
 * src/app.js); o JSON re-serializado não serve, porque não bate byte a byte.
 */
function verifyInstagramSignature(req, res, next) {
  const secret = env.instagram.appSecret;
  if (!secret) {
    return next(new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'INSTAGRAM_APP_SECRET não configurado.'));
  }

  const header = req.get('x-hub-signature-256') || '';
  const raw = req.rawBody;
  if (!raw || !header.startsWith('sha256=')) {
    return next(new AppError(401, 'INVALID_SIGNATURE', 'Assinatura inválida.'));
  }

  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const provided = header.slice('sha256='.length);
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const ok = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!ok) {
    return next(new AppError(401, 'INVALID_SIGNATURE', 'Assinatura inválida.'));
  }
  return next();
}

module.exports = verifyInstagramSignature;
