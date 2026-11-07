const { Router } = require('express');

const validate = require('../middlewares/validate');
const schemas = require('../validators/campaignValidators');
const { campaignVisitLimiter } = require('../middlewares/rateLimiters');
const controller = require('../controllers/campaignsController');

const router = Router();

router.post('/campaigns/visit', campaignVisitLimiter, validate(schemas.visit), controller.visit);

module.exports = router;
