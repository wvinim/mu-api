const sql = require('mssql');
const AppError = require('../utils/AppError');
const env = require('../config/env');

// Não loga aqui: o httpLogger grava uma única linha por request com
// status + res.locals.errorCode, e para 5xx também o stack (via res.err).
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    res.locals.errorCode = err.code;
    if (err.statusCode >= 500) res.err = err;
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  res.err = err;

  // Banco caiu depois da conexão inicial: o mssql lança ConnectionError ao
  // tentar pegar conexão do pool. É indisponibilidade, não bug — 503.
  if (err instanceof sql.ConnectionError) {
    res.locals.errorCode = 'DB_UNAVAILABLE';
    return res.status(503).json({
      error: {
        code: 'DB_UNAVAILABLE',
        message: 'Banco de dados indisponível no momento. Tente novamente em instantes.',
      },
    });
  }

  res.locals.errorCode = 'INTERNAL_ERROR';
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.isProduction ? 'Erro interno do servidor.' : err.message,
    },
  });
}

module.exports = errorHandler;
