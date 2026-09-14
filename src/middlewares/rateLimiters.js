const rateLimit = require('express-rate-limit');
const env = require('../config/env');

/**
 * Rate limit em memória — aceitável para instância única (decisão do
 * CLAUDE.md). Se confirmarmos múltiplas instâncias atrás de um load
 * balancer, precisamos migrar para um store compartilhado (ex: Redis)
 * antes disso virar um problema de bypass entre instâncias.
 */
function buildLimiter({ windowMinutes, max, keyGenerator, code, message }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
      res.status(429).json({ error: { code, message } });
    },
  });
}

const loginIpLimiter = buildLimiter({
  windowMinutes: env.rateLimit.loginWindowMinutes,
  max: env.rateLimit.loginMax,
  keyGenerator: (req) => req.ip,
  code: 'TOO_MANY_LOGIN_ATTEMPTS',
  message: 'Muitas tentativas de login. Tente novamente mais tarde.',
});

const loginUsernameLimiter = buildLimiter({
  windowMinutes: env.rateLimit.loginWindowMinutes,
  max: env.rateLimit.loginMax,
  keyGenerator: (req) => `username:${req.body?.username || 'unknown'}`,
  code: 'TOO_MANY_LOGIN_ATTEMPTS',
  message: 'Muitas tentativas de login para este usuário. Tente novamente mais tarde.',
});

const resendConfirmationLimiter = buildLimiter({
  windowMinutes: env.rateLimit.resendConfirmationWindowMinutes,
  max: env.rateLimit.resendConfirmationMax,
  keyGenerator: (req) => `email:${req.body?.email || 'unknown'}`,
  code: 'TOO_MANY_REQUESTS',
  message: 'Muitos pedidos de reenvio de confirmação. Tente novamente mais tarde.',
});

const forgotPasswordLimiter = buildLimiter({
  windowMinutes: env.rateLimit.forgotPasswordWindowMinutes,
  max: env.rateLimit.forgotPasswordMax,
  keyGenerator: (req) => `email:${req.body?.email || 'unknown'}`,
  code: 'TOO_MANY_REQUESTS',
  message: 'Muitos pedidos de redefinição de senha. Tente novamente mais tarde.',
});

// Evita clique duplicado na compra/resgate.
const purchaseLimiter = buildLimiter({
  windowMinutes: env.rateLimit.purchaseWindowSeconds / 60,
  max: env.rateLimit.purchaseMax,
  keyGenerator: (req) => `purchase:${req.user?.username || req.ip}`,
  code: 'TOO_MANY_REQUESTS',
  message: 'Aguarde alguns segundos antes de tentar novamente.',
});

const ticketCreateLimiter = buildLimiter({
  windowMinutes: env.rateLimit.ticketCreateWindowMinutes,
  max: env.rateLimit.ticketCreateMax,
  keyGenerator: (req) => `ticket:${req.user?.username || req.ip}`,
  code: 'TOO_MANY_REQUESTS',
  message: 'Muitos tickets criados. Tente novamente mais tarde.',
});

module.exports = {
  loginIpLimiter,
  loginUsernameLimiter,
  resendConfirmationLimiter,
  forgotPasswordLimiter,
  purchaseLimiter,
  ticketCreateLimiter,
};
