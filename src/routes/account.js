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

// Seleção de itens do autopick VIP (só Mega Vip pode gravar, ver
// docs/SECTION_9_VIP.md) — GET funciona pra qualquer conta autenticada,
// mesmo sem ser Mega Vip no momento (só mostra o que já foi salvo antes).
router.get('/account/autopick', controller.getAutopick);
router.put('/account/autopick', validate(schemas.updateAutopick), controller.updateAutopick);

module.exports = router;
