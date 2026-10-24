const env = require('../config/env');

/**
 * Bônus do beta aberto: Cash + VIP concedidos uma única vez, quando a conta
 * confirma o e-mail (não no registro — exige um e-mail confirmado por conta,
 * o que dificulta farm de contas). Vale só para confirmações feitas antes de
 * BETA_BONUS_ENDS_AT; depois dessa data desliga sozinho, sem deploy.
 *
 * Retorna null quando não há bônus a conceder agora.
 */
function current(now = new Date()) {
  const { endsAt, cash, vipTier, vipDays } = env.betaBonus;
  if (!endsAt || now >= endsAt) return null;

  const hasVip = vipTier > 0 && vipDays > 0;
  if (cash <= 0 && !hasVip) return null;

  return { cash: Math.max(cash, 0), vipTier: hasVip ? vipTier : 0, vipDays: hasVip ? vipDays : 0 };
}

module.exports = { current };
