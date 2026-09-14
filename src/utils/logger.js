const pino = require('pino');
const env = require('../config/env');

const isTest = env.nodeEnv === 'test';

const logger = pino({
  level: isTest ? 'silent' : env.isProduction ? 'info' : 'debug',
  transport: isTest || env.isProduction
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

module.exports = logger;
