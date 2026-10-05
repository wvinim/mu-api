const { Router } = require('express');

const requireAuth = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const schemas = require('../validators/characterValidators');
const controller = require('../controllers/showcaseController');

const router = Router();

// Vitrine do mercado (/mercado no jogo). Ver docs/SECTION_10_MARKET.md.
// /showcase/me antes de /showcase/:name, senão "me" vira nome de personagem.
router.get('/showcase/me', requireAuth, controller.getMine);
router.get('/showcase/:name', validate(schemas.nameParam, 'params'), controller.getByCharacter);

module.exports = router;
