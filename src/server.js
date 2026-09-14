const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { connectDB, closeDB } = require('./db/pool');

let server;

async function start() {
  try {
    await connectDB();
  } catch (err) {
    logger.error({ err }, 'Falha ao conectar no SQL Server na inicialização');
    process.exit(1);
  }

  server = app.listen(env.port, () => {
    logger.info(`API rodando em http://localhost:${env.port} (${env.nodeEnv})`);
  });
}

async function shutdown(signal) {
  logger.info(`Recebido ${signal}, encerrando graciosamente...`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closeDB();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
