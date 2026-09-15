const Joi = require('joi');

const createTicket = Joi.object({
  subject: Joi.string().max(200).required(),
  message: Joi.string().max(4000).required(),
});

const reply = Joi.object({
  message: Joi.string().max(4000).required(),
});

const listQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('open', 'closed'),
});

const idParam = Joi.object({
  id: Joi.number().integer().min(1).required(),
});

module.exports = { createTicket, reply, listQuery, idParam };
