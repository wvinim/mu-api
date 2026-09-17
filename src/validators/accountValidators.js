const Joi = require('joi');

// memb_name é varchar(10) na tabela de contas.
const updateProfile = Joi.object({
  displayName: Joi.string().max(10).required(),
});

const securityLogQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

// Só valida o formato — a checagem contra a lista fechada de itens
// permitidos (ver src/services/vipAutopickCatalog.js) é feita no
// controller, não aqui.
const autopickItem = Joi.object({
  itemGroup: Joi.number().integer().min(0).required(),
  itemIndex: Joi.number().integer().min(0).required(),
  itemLevel: Joi.number().integer().min(0).required(),
});

const updateAutopick = Joi.object({
  // .unique() sem argumento compara por igualdade profunda do objeto
  // inteiro — bloqueia entradas duplicadas (mesmo grupo+índice+level),
  // não itens com o mesmo grupo (ex: duas jóias do grupo 14 são válidas).
  items: Joi.array().items(autopickItem).max(12).unique().required(),
});

module.exports = { updateProfile, securityLogQuery, updateAutopick };
