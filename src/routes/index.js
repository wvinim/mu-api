const { Router } = require('express');
const healthRoutes = require('./health');
const authRoutes = require('./auth');
const accountRoutes = require('./account');
const charactersRoutes = require('./characters');
const shopRoutes = require('./shop');
const supportRoutes = require('./support');
const adminRoutes = require('./admin');
const serverRoutes = require('./server');

const router = Router();

router.use(healthRoutes);
router.use(authRoutes);
router.use(accountRoutes);
router.use(charactersRoutes);
router.use(shopRoutes);
router.use(supportRoutes);
router.use(adminRoutes);
router.use(serverRoutes);

module.exports = router;
