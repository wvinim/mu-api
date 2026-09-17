const Joi = require('joi');

const CATALOG_ID_PATTERN = /^(credit|item|bundle|vip):\d+$/;

const catalogIdParam = Joi.object({
  id: Joi.string().pattern(CATALOG_ID_PATTERN).required(),
});

const purchase = Joi.object({
  catalogId: Joi.string().pattern(CATALOG_ID_PATTERN).required(),
  // Resgate de item/pacote passou a ir pro baú da conta (warehouse), não
  // mais pro personagem — não recebe characterName (nenhum catalogId
  // recebe mais). `stripUnknown: true` no middleware `validate` descarta
  // silenciosamente um characterName que um front-end desatualizado ainda envie.
});

const historyQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = { catalogIdParam, purchase, historyQuery };
