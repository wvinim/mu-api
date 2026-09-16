const { Router } = require('express');

const requireAuth = require('../middlewares/auth');
const requireRole = require('../middlewares/requireRole');
const validate = require('../middlewares/validate');
const schemas = require('../validators/adminValidators');
const controller = require('../controllers/adminController');

const router = Router();

// Autorização reforçada: só admin, nenhuma rota /admin aceita staff.
router.use('/admin', requireAuth, requireRole('admin'));

router.get('/admin/accounts', validate(schemas.accountsListQuery, 'query'), controller.listAccounts);
router.post('/admin/accounts/:id/ban', validate(schemas.accountIdParam, 'params'), controller.banAccount);
router.post('/admin/accounts/:id/unban', validate(schemas.accountIdParam, 'params'), controller.unbanAccount);

router.get('/admin/logs', validate(schemas.logsListQuery, 'query'), controller.listLogs);

router.get('/admin/shop/items', controller.listShopItems);
router.post('/admin/shop/items', validate(schemas.createShopItem), controller.createShopItem);
router.patch(
  '/admin/shop/items/:id',
  validate(schemas.shopItemIdParam, 'params'),
  validate(schemas.updateShopItem),
  controller.updateShopItem,
);
router.delete('/admin/shop/items/:id', validate(schemas.shopItemIdParam, 'params'), controller.deactivateShopItem);

// Pacotes (bundles) — combinam vários itens de /admin/shop/items num
// produto vendido por um preço único. Ver docs/SECTION_5_SHOP.md.
router.get('/admin/shop/bundles', controller.listShopBundles);
router.post('/admin/shop/bundles', validate(schemas.createShopBundle), controller.createShopBundle);
router.patch(
  '/admin/shop/bundles/:id',
  validate(schemas.bundleIdParam, 'params'),
  validate(schemas.updateShopBundle),
  controller.updateShopBundle,
);
router.delete('/admin/shop/bundles/:id', validate(schemas.bundleIdParam, 'params'), controller.deactivateShopBundle);

// Extensão além do brief literal (só citava "shop/items") — necessária pra
// gerenciar os pacotes de crédito sem SQL manual. Ver docs/SECTION_7_ADMIN.md.
router.get('/admin/shop/credit-packages', controller.listCreditPackages);
router.post('/admin/shop/credit-packages', validate(schemas.createCreditPackage), controller.createCreditPackage);
router.patch(
  '/admin/shop/credit-packages/:id',
  validate(schemas.creditPackageIdParam, 'params'),
  validate(schemas.updateCreditPackage),
  controller.updateCreditPackage,
);
router.delete(
  '/admin/shop/credit-packages/:id',
  validate(schemas.creditPackageIdParam, 'params'),
  controller.deactivateCreditPackage,
);

module.exports = router;
