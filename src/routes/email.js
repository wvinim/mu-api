const { Router } = require('express');
const controller = require('../controllers/emailCampaignsController');

const router = Router();

// Descadastro dos e-mails de divulgação (link no rodapé e cabeçalho
// List-Unsubscribe). Público: a autenticidade vem do token HMAC na query.
// Ver docs/SECTION_12_EMAIL_CAMPAIGNS.md.
router.get('/email/unsubscribe', controller.showUnsubscribe);
router.post('/email/unsubscribe', controller.confirmUnsubscribe);

module.exports = router;
