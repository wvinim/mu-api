const Joi = require('joi');

const CATALOG_ID_PATTERN = /^(credit|item|bundle|vip):\d+$/;

const catalogIdParam = Joi.object({
  id: Joi.string().pattern(CATALOG_ID_PATTERN).required(),
});

const purchase = Joi.object({
  catalogId: Joi.string().pattern(CATALOG_ID_PATTERN).required(),
  // Só é obrigatório para resgate de item ou pacote (catalogId "item:*"
  // ou "bundle:*") — validado de novo no controller, porque o Joi não
  // sabe recortar o prefixo aqui sem uma regra `when` mais frágil de manter.
  // Nunca usado pra "credit:*"/"vip:*" (compra é da conta, não do personagem).
  characterName: Joi.string().max(10),
});

const historyQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = { catalogIdParam, purchase, historyQuery };
