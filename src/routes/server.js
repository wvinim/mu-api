const { Router } = require('express');

const controller = require('../controllers/serverController');

const router = Router();

router.get('/server/status', controller.getStatus);
router.get('/server/info', controller.getInfo);

module.exports = router;
