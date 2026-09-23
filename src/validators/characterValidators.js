const Joi = require('joi');

const nameParam = Joi.object({
  name: Joi.string().max(10).required(),
});

const rankingQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  classCode: Joi.number().integer().min(0).max(255),
});

module.exports = { nameParam, rankingQuery };
