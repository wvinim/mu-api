const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { createHttpLogger } = require('./utils/httpLogger');

const env = require('./config/env');
const logger = require('./utils/logger');
const routes = require('./routes');
const healthRoutes = require('./routes/health');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

if (env.trustProxy > 0) {
  app.set('trust proxy', env.trustProxy);
}

app.use(helmet());

// TODO: antes de ir para produção, confirmar o(s) domínio(s) finais do site
// com o usuário e travar CORS_ALLOWED_ORIGINS no .env de produção — hoje
// aceitamos qualquer origin em dev para não travar o front-end local.
app.use(
  cors({
    origin: env.isProduction ? env.cors.allowedOrigins : true,
    credentials: true,
  }),
);

app.use(express.json());
app.use(createHttpLogger(logger));

app.use('/api/v1', routes);
// Liveness/readiness sem o prefixo de versão, para probes de infra (ex: nginx, pm2, monitoramento).
app.use(healthRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
