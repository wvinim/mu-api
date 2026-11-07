const Joi = require('joi');

// Código de campanha: o mesmo padrão do CHECK de WebCampaigns (migration
// 0015), sempre gravado em minúsculo.
const CAMPAIGN_CODE_PATTERN = /^[a-z0-9_-]{2,30}$/;

const visit = Joi.object({
  code: Joi.string().trim().lowercase().pattern(CAMPAIGN_CODE_PATTERN).required(),
  visitorId: Joi.string().guid().required(),
});

module.exports = { visit, CAMPAIGN_CODE_PATTERN };
