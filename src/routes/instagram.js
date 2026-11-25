const crypto = require('crypto');
const { Router } = require('express');
const env = require('../config/env');
const logger = require('../utils/logger');
const verifyInstagramSignature = require('../middlewares/verifyInstagramSignature');
const requireAuth = require('../middlewares/auth');
const { instagramLinkCodeLimiter } = require('../middlewares/rateLimiters');
const controller = require('../controllers/instagramController');
const campaign = require('../services/instagramCampaignService');

/**
 * Campanha de story no Instagram (docs/SECTION_15_INSTAGRAM.md).
 * Webhook `messages` da Meta + rotas da conta para vincular o Instagram.
 */
const router = Router();

// Verificação do painel da Meta: devolve hub.challenge se o token bater.
router.get('/instagram/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const expected = env.instagram.verifyToken;

  const tokenOk =
    expected &&
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));

  if (mode === 'subscribe' && tokenOk) {
    logger.info('instagram webhook: verificação aceita');
    return res.status(200).type('text/plain').send(challenge);
  }
  logger.warn({ mode }, 'instagram webhook: verificação recusada');
  return res.sendStatus(403);
});

// Erro aqui = 500 e a Meta reenvia (processamento idempotente).
router.post('/instagram/webhook', verifyInstagramSignature, async (req, res, next) => {
  try {
    await campaign.handleWebhook(req.body);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

// Pública: valores da campanha para o hotsite (mupro.vip/instagram).
router.get('/instagram/campaign', (req, res) => res.json(campaign.getPublicInfo()));

router.get('/account/instagram', requireAuth, controller.getStatus);
router.post(
  '/account/instagram/link-code',
  requireAuth,
  controller.requireCampaign,
  instagramLinkCodeLimiter,
  controller.createLinkCode,
);
router.delete('/account/instagram', requireAuth, controller.unlink);

module.exports = router;
