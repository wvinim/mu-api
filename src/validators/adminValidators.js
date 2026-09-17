const Joi = require('joi');

const accountIdParam = Joi.object({
  id: Joi.string().max(10).required(),
});

const accountsListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(50),
  banned: Joi.boolean(),
});

const logsListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  accountId: Joi.string().max(10),
  eventType: Joi.string().max(50),
});

const shopItemIdParam = Joi.object({
  id: Joi.number().integer().min(1).required(),
});

const createShopItem = Joi.object({
  name: Joi.string().max(50).required(),
  description: Joi.string().max(255).allow('', null),
  priceCredits: Joi.number().integer().min(0).required(),
  itemGroup: Joi.number().integer().min(0).max(255).required(),
  itemIndex: Joi.number().integer().min(0).max(32767).required(),
  itemLevel: Joi.number().integer().min(0).max(15).default(0),
  quantity: Joi.number().integer().min(1).max(255).default(1),
  active: Joi.boolean().default(true),
});

const updateShopItem = Joi.object({
  name: Joi.string().max(50),
  description: Joi.string().max(255).allow('', null),
  priceCredits: Joi.number().integer().min(0),
  itemGroup: Joi.number().integer().min(0).max(255),
  itemIndex: Joi.number().integer().min(0).max(32767),
  itemLevel: Joi.number().integer().min(0).max(15),
  quantity: Joi.number().integer().min(1).max(255),
  active: Joi.boolean(),
}).min(1);

const bundleIdParam = shopItemIdParam;

const bundleItem = Joi.object({
  shopItemId: Joi.number().integer().min(1).required(),
  quantity: Joi.number().integer().min(1).max(255).default(1),
});

const createShopBundle = Joi.object({
  name: Joi.string().max(50).required(),
  description: Joi.string().max(255).allow('', null),
  priceCredits: Joi.number().integer().min(0).required(),
  active: Joi.boolean().default(true),
  items: Joi.array().items(bundleItem).min(1).required(),
});

const updateShopBundle = Joi.object({
  name: Joi.string().max(50),
  description: Joi.string().max(255).allow('', null),
  priceCredits: Joi.number().integer().min(0),
  active: Joi.boolean(),
  items: Joi.array().items(bundleItem).min(1),
}).min(1);

const creditPackageIdParam = shopItemIdParam;

const createCreditPackage = Joi.object({
  name: Joi.string().max(50).required(),
  priceCents: Joi.number().integer().min(1).required(),
  creditsAmount: Joi.number().integer().min(1).required(),
  active: Joi.boolean().default(true),
});

const updateCreditPackage = Joi.object({
  name: Joi.string().max(50),
  priceCents: Joi.number().integer().min(1),
  creditsAmount: Joi.number().integer().min(1),
  active: Joi.boolean(),
}).min(1);

const vipPlanIdParam = shopItemIdParam;

// Só PriceCredits/Active são editáveis — Tier/Name/DurationDays são fixos
// (decisão do usuário: catálogo de VIP não é um CRUD livre).
const updateVipPlan = Joi.object({
  priceCredits: Joi.number().integer().min(0),
  active: Joi.boolean(),
}).min(1);

// tier=0 revoga (não precisa de days); tier 1/2/3 exige days (dias somados
// à validade atual, mesma regra da compra normal).
const setAccountVip = Joi.object({
  tier: Joi.number().integer().min(0).max(3).required(),
  days: Joi.number()
    .integer()
    .min(1)
    .when('tier', { is: 0, then: Joi.forbidden(), otherwise: Joi.required() }),
});

module.exports = {
  accountIdParam,
  accountsListQuery,
  logsListQuery,
  shopItemIdParam,
  createShopItem,
  updateShopItem,
  bundleIdParam,
  createShopBundle,
  updateShopBundle,
  creditPackageIdParam,
  createCreditPackage,
  updateCreditPackage,
  vipPlanIdParam,
  updateVipPlan,
  setAccountVip,
};
