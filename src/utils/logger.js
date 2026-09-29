const pino = require('pino');
const env = require('../config/env');

const isTest = env.nodeEnv === 'test';

const logger = pino({
  // hostname é sempre o mesmo servidor; pid fica para detectar restarts.
  base: { pid: process.pid },
  level: isTest ? 'silent' : env.isProduction ? 'info' : 'debug',
  transport: isTest || env.isProduction
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

module.exports = logger;
