const pinoHttp = require('pino-http');

// Segredo do webhook Efí vai no path (/shop/payment/webhook/<segredo>[/pix]).
const WEBHOOK_SECRET_IN_PATH = /(\/shop\/payment\/webhook\/)[^/?]+/;
const REDACTED = '[redacted]';

/**
 * Log de requests sem credenciais: o log padrão do pino-http grava todos os
 * headers — incluindo o Bearer token (sequestro de sessão por quem lê o
 * log) — e a URL completa, que no webhook contém o segredo.
 */
function redactRequest(req) {
  if (req.headers) {
    const headers = { ...req.headers };
    if (headers.authorization) headers.authorization = REDACTED;
    if (headers.cookie) headers.cookie = REDACTED;
    req.headers = headers;
  }
  if (typeof req.url === 'string') req.url = req.url.replace(WEBHOOK_SECRET_IN_PATH, `$1${REDACTED}`);
  if (req.params && req.params.secret) req.params = { ...req.params, secret: REDACTED };
  return req;
}

function redactResponse(res) {
  if (res.headers && res.headers['set-cookie']) {
    res.headers = { ...res.headers, 'set-cookie': REDACTED };
  }
  return res;
}

function createHttpLogger(logger) {
  return pinoHttp({ logger, serializers: { req: redactRequest, res: redactResponse } });
}

module.exports = { createHttpLogger };
