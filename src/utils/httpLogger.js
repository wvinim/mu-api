const pinoHttp = require('pino-http');

// Segredo do webhook Efí vai no path (/shop/payment/webhook/<segredo>[/pix]).
const WEBHOOK_SECRET_IN_PATH = /(\/shop\/payment\/webhook\/)[^/?]+/;
const REDACTED = '[redacted]';

/**
 * Uma linha curta por request. Headers ficam fora de propósito: além de
 * inflar o log (varredura de bots gerava ~1.5 KB por linha), eles carregam
 * o Bearer token e cookies. A URL é redigida porque no webhook ela contém
 * o segredo. `ip` vem de req.ip, que respeita TRUST_PROXY (IP real atrás
 * do nginx).
 */
function serializeRequest(req) {
  const raw = req.raw || {};
  const headers = raw.headers || {};
  return {
    id: req.id,
    method: req.method,
    url: typeof req.url === 'string' ? req.url.replace(WEBHOOK_SECRET_IN_PATH, `$1${REDACTED}`) : req.url,
    ip: raw.ip || req.remoteAddress,
    ua: headers['user-agent'],
  };
}

function serializeResponse(res) {
  return { statusCode: res.statusCode };
}

// 404 fica em info: é quase sempre varredura de bots e afogaria os warns
// que importam (401, 403, 429...).
function logLevel(req, res, err) {
  if (err || res.err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400 && res.statusCode !== 404) return 'warn';
  return 'info';
}

// O errorHandler não loga por conta própria; ele deixa o código do erro em
// res.locals.errorCode e ele sai na linha de conclusão do request.
function withErrorCode(res, val) {
  const code = res.locals && res.locals.errorCode;
  return code ? { ...val, errorCode: code } : val;
}

function createHttpLogger(logger) {
  return pinoHttp({
    logger,
    serializers: { req: serializeRequest, res: serializeResponse },
    customLogLevel: logLevel,
    customSuccessObject: (req, res, val) => withErrorCode(res, val),
    customErrorObject: (req, res, err, val) => withErrorCode(res, val),
  });
}

module.exports = { createHttpLogger };
