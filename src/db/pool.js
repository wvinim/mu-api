const sql = require('mssql');
const env = require('../config/env');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * Pool único e compartilhado. O gameserver em C++ usa este mesmo banco em
 * produção — nunca abrir pools ad-hoc por request, e nunca rodar DDL aqui.
 */
let pool = null;

const config = {
  server: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  options: {
    encrypt: env.db.encrypt,
    trustServerCertificate: env.db.trustServerCertificate,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

async function connectDB() {
  if (pool) return pool;
  pool = await new sql.ConnectionPool(config).connect();
  pool.on('error', (err) => {
    logger.error({ err }, 'Erro no pool de conexão SQL Server');
  });
  logger.info(
    { host: env.db.host, database: env.db.database },
    'Conectado ao SQL Server',
  );
  return pool;
}

/**
 * Usado pelo server.js: tenta conectar até conseguir, com backoff exponencial
 * (1s, 2s, 4s... até maxDelayMs). Nunca derruba o processo — antes, uma queda
 * do banco fazia a API sair e o gerenciador de processos religá-la em loop,
 * travando a CPU. Enquanto não conecta, getPool() responde 503.
 */
let stopRetrying = false;

async function connectWithRetry({ initialDelayMs = 1000, maxDelayMs = 30000 } = {}) {
  let delay = initialDelayMs;
  for (let attempt = 1; !stopRetrying; attempt += 1) {
    try {
      return await connectDB();
    } catch (err) {
      logger.error({ err, attempt, nextRetryMs: delay }, 'Falha ao conectar no SQL Server — tentando de novo');
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
  return null;
}

function getPool() {
  if (!pool) {
    throw new AppError(503, 'DB_UNAVAILABLE', 'Banco de dados indisponível no momento. Tente novamente em instantes.');
  }
  return pool;
}

async function closeDB() {
  stopRetrying = true;
  if (pool) {
    await pool.close();
    pool = null;
  }
}

module.exports = { sql, connectDB, connectWithRetry, getPool, closeDB };
