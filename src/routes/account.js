const { Router } = require('express');

const requireAuth = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const schemas = require('../validators/accountValidators');
const controller = require('../controllers/accountController');

const router = Router();

router.use('/account', requireAuth);

router.get('/account/me', controller.getMe);
router.patch('/account/me', validate(schemas.updateProfile), controller.updateMe);
router.get('/account/characters', controller.getCharacters);
router.get('/account/security-log', validate(schemas.securityLogQuery, 'query'), controller.getSecurityLog);

module.exports = router;
