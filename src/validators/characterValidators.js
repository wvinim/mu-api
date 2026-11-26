const Joi = require('joi');

// Ranking = top 10 por período (desde 2026-11-26). `page` e `limit` até 100
// continuam aceitos para o front antigo não receber 400 durante o deploy:
// `page` é ignorado e `limit` passa por min(limit, 10) no repositório.
const rankingQuery = Joi.object({
  period: Joi.string().valid('total', 'month', 'week', 'day').default('total'),
  // Período anterior (semana passada, ontem...). Não existe para o total.
  previous: Joi.boolean().default(false).when('period', {
    is: 'total',
    then: Joi.valid(false),
  }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  classCode: Joi.number().integer().min(0).max(255),
});

module.exports = { rankingQuery };
