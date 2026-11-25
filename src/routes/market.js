const { Router } = require('express');

const requireAuth = require('../middlewares/auth');
const requireRole = require('../middlewares/requireRole');
const validate = require('../middlewares/validate');
const { marketWriteLimiter } = require('../middlewares/rateLimiters');
const schemas = require('../validators/marketValidators');
const controller = require('../controllers/marketController');

/**
 * Mercado entre jogadores — docs/SECTION_14_MARKET.md.
 * Com MARKET_ENABLED=false, só as contas de MARKET_TESTERS passam
 * (requireMarketAccess). O catálogo é público (só a lista de itens).
 */
const router = Router();

router.get('/market/catalog', controller.getCatalog);

// Admin: seriais repetidos (decisão 8). Fora do requireMarketAccess.
router.get('/admin/market/repeated-serials', requireAuth, requireRole('admin'), controller.getRepeatedSerials);

const access = [requireAuth, controller.requireMarketAccess];

router.get('/market/vaults', ...access, controller.getVaults);
router.get('/market/listings', ...access, validate(schemas.searchQuery, 'query'), controller.searchListings);
router.get('/market/listings/:id', ...access, validate(schemas.listingIdParam, 'params'), controller.getListing);
router.get('/market/my/listings', ...access, validate(schemas.mineQuery, 'query'), controller.getMyListings);
router.get('/market/my/purchases', ...access, validate(schemas.purchasesQuery, 'query'), controller.getMyPurchases);

router.post('/market/listings', ...access, marketWriteLimiter, validate(schemas.createListing), controller.createListing);
router.post(
  '/market/listings/:id/buy',
  ...access,
  marketWriteLimiter,
  validate(schemas.listingIdParam, 'params'),
  validate(schemas.destination),
  controller.buyListing,
);
router.post(
  '/market/listings/:id/return',
  ...access,
  marketWriteLimiter,
  validate(schemas.listingIdParam, 'params'),
  validate(schemas.destination),
  controller.returnListing,
);
router.post(
  '/market/listings/:id/renew',
  ...access,
  marketWriteLimiter,
  validate(schemas.listingIdParam, 'params'),
  controller.renewListing,
);

module.exports = router;
