/**
 * Bônus de boas-vindas: Mega Vip por 3 dias, concedido uma única vez quando
 * a conta confirma o e-mail (não no registro — exige um e-mail confirmado
 * por conta, o que dificulta farm de contas). Valores fixos, sem env var.
 */
const WELCOME_BONUS = Object.freeze({ cash: 0, vipTier: 3, vipDays: 3 });

module.exports = { WELCOME_BONUS };
