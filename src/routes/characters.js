const { Router } = require('express');

const validate = require('../middlewares/validate');
const schemas = require('../validators/characterValidators');
const controller = require('../controllers/charactersController');

const router = Router();

// Rotas públicas — não exigem autenticação. Nunca expõem inventário,
// dinheiro ou posição no mapa (ver docs/SECTION_4_CHARACTERS.md).
router.get('/characters/ranking', validate(schemas.rankingQuery, 'query'), controller.getRanking);
router.get('/characters/:name', validate(schemas.nameParam, 'params'), controller.getByName);

module.exports = router;
