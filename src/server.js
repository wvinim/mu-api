const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { connectWithRetry, closeDB } = require('./db/pool');

let server;

function start() {
  // Sobe o HTTP antes do banco: sem banco as rotas respondem 503 DB_UNAVAILABLE
  // (com CORS) em vez de o processo sair e o pm2/systemd religar em loop.
  server = app.listen(env.port, env.host, () => {
    logger.info(`API rodando em http://${env.host}:${env.port} (${env.nodeEnv})`);
  });
  connectWithRetry();
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
