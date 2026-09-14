const sql = require('mssql');
const env = require('../config/env');
const logger = require('../utils/logger');

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

function getPool() {
  if (!pool) {
    throw new Error('Pool de conexão ainda não inicializado. Chame connectDB() primeiro.');
  }
  return pool;
}

async function closeDB() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

module.exports = { sql, connectDB, getPool, closeDB };
