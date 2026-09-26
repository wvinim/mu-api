const sql = require('mssql');
const AppError = require('../utils/AppError');
const env = require('../config/env');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    req.log?.warn({ err }, err.message);
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // Banco caiu depois da conexão inicial: o mssql lança ConnectionError ao
  // tentar pegar conexão do pool. É indisponibilidade, não bug — 503.
  if (err instanceof sql.ConnectionError) {
    req.log?.error({ err }, 'SQL Server indisponível');
    return res.status(503).json({
      error: {
        code: 'DB_UNAVAILABLE',
        message: 'Banco de dados indisponível no momento. Tente novamente em instantes.',
      },
    });
  }

  req.log?.error({ err }, 'Erro não tratado');

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.isProduction ? 'Erro interno do servidor.' : err.message,
    },
  });
}

module.exports = errorHandler;
