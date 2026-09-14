const { Router } = require('express');

const requireAuth = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const verifyWebhookSecret = require('../middlewares/verifyWebhookSecret');
const { purchaseLimiter } = require('../middlewares/rateLimiters');
const schemas = require('../validators/shopValidators');
const controller = require('../controllers/shopController');

const router = Router();

// Públicas
router.get('/shop/items', controller.getItems);
router.get('/shop/items/:id', validate(schemas.catalogIdParam, 'params'), controller.getItemById);

// Webhook da Efí — sem requireAuth (não é chamado por um usuário logado),
// protegido por segredo na URL. Ver docs/SECTION_5_SHOP.md.
router.post('/shop/payment/webhook/:secret', verifyWebhookSecret, controller.paymentWebhook);

// Autenticadas
router.post('/shop/purchase', requireAuth, purchaseLimiter, validate(schemas.purchase), controller.purchase);
router.get('/shop/credits', requireAuth, controller.getCredits);
router.get('/shop/history', requireAuth, validate(schemas.historyQuery, 'query'), controller.getHistory);

module.exports = router;
