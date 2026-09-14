const Joi = require('joi');

// memb_name é varchar(10) na tabela de contas.
const updateProfile = Joi.object({
  displayName: Joi.string().max(10).required(),
});

const securityLogQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = { updateProfile, securityLogQuery };
