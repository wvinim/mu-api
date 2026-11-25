const Joi = require('joi');
const { CATEGORY_IDS, CLASS_IDS } = require('../services/marketItemService');

// Limites da decisão 4 (docs/SECTION_14_MARKET.md). A procedure confere de novo.
const MIN_PRICE = 10;
const MAX_PRICE = 10000;

const listingIdParam = Joi.object({
  id: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).required(),
});

const vaultId = Joi.number().integer().min(0).max(255).required();

const createListing = Joi.object({
  vaultId,
  slot: Joi.number().integer().min(0).max(119).required(),
  price: Joi.number().integer().min(MIN_PRICE).max(MAX_PRICE).required(),
});

// Comprar e retirar: o jogador escolhe o baú de destino (decisão 1).
const destination = Joi.object({ vaultId });

// `category` aceita uma ou várias, separadas por vírgula (?category=helm,armor).
const searchQuery = Joi.object({
  category: Joi.string()
    .custom((value, helpers) => {
      const list = value.split(',').map((c) => c.trim()).filter(Boolean);
      if (list.length === 0 || list.some((c) => !CATEGORY_IDS.includes(c))) return helpers.error('any.invalid');
      return [...new Set(list)];
    })
    .optional(),
  class: Joi.string().valid(...CLASS_IDS).optional(),
  group: Joi.number().integer().min(0).max(15).optional(),
  index: Joi.number().integer().min(0).max(511).optional(),
  minLevel: Joi.number().integer().min(0).max(15).optional(),
  minExc: Joi.number().integer().min(0).max(6).optional(),
  skill: Joi.boolean().optional(),
  luck: Joi.boolean().optional(),
  minPrice: Joi.number().integer().min(0).max(MAX_PRICE).optional(),
  maxPrice: Joi.number().integer().min(0).max(MAX_PRICE).optional(),
  q: Joi.string().trim().min(1).max(50).optional(),
  sort: Joi.string().valid('newest', 'price_asc', 'price_desc', 'level_desc', 'exc_desc').default('newest'),
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

const mineQuery = Joi.object({
  state: Joi.string().valid('active', 'expired', 'sold', 'returned').optional(),
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

const purchasesQuery = Joi.object({
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

module.exports = {
  MIN_PRICE,
  MAX_PRICE,
  listingIdParam,
  createListing,
  destination,
  searchQuery,
  mineQuery,
  purchasesQuery,
};
