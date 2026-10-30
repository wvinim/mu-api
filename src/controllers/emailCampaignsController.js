const AppError = require('../utils/AppError');
const accountsRepository = require('../db/accountsRepository');
const auditLogRepository = require('../db/auditLogRepository');
const emailCampaignService = require('../services/emailCampaignService');
const { listCampaignKeys } = require('../emails/campaigns');

/**
 * Campanhas de e-mail de divulgação (admin) e descadastro (público).
 * Ver docs/SECTION_12_EMAIL_CAMPAIGNS.md.
 */

function logAdminAction(req, eventType, details) {
  return auditLogRepository.record({
    accountId: req.user.username,
    username: req.user.username,
    eventType,
    success: true,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details,
  });
}

async function listCampaigns(req, res, next) {
  try {
    const items = await Promise.all(listCampaignKeys().map((key) => emailCampaignService.getCampaignStatus(key)));
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

async function getCampaign(req, res, next) {
  try {
    res.json(await emailCampaignService.getCampaignStatus(req.params.key));
  } catch (err) {
    next(err);
  }
}

async function sendTest(req, res, next) {
  try {
    const { key } = req.params;
    const admin = await accountsRepository.findByUsername(req.user.username);
    const to = req.body.to || admin?.email;
    if (!to) throw new AppError(400, 'VALIDATION_ERROR', 'Informe `to`: sua conta não tem e-mail cadastrado.');

    const name = (admin?.displayName || '').trim() || req.user.username;
    await emailCampaignService.sendTest(key, { to, name });
    await logAdminAction(req, 'admin.email_campaign_test', { campaignKey: key, to });

    res.json({ message: `E-mail de teste enviado para ${to}.` });
  } catch (err) {
    next(err);
  }
}

async function startCampaign(req, res, next) {
  try {
    const { key } = req.params;
    const job = await emailCampaignService.startCampaign(key, { startedBy: req.user.username });
    await logAdminAction(req, 'admin.email_campaign_send', { campaignKey: key, total: job.total });

    res.status(202).json({ message: `Envio iniciado para ${job.total} destinatário(s).`, job });
  } catch (err) {
    next(err);
  }
}

async function cancelCampaign(req, res, next) {
  try {
    const { key } = req.params;
    emailCampaignService.cancelCampaign(key);
    await logAdminAction(req, 'admin.email_campaign_cancel', { campaignKey: key });

    res.json({ message: 'O envio vai parar depois do e-mail atual.' });
  } catch (err) {
    next(err);
  }
}

// ---- Descadastro (público, link do rodapé do e-mail) ----

function renderPage(title, message, form = '') {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — MU PRO</title>
</head>
<body style="margin:0; padding:48px 16px; background:#06040c; color:#c4b4e6; font-family:Arial, Helvetica, sans-serif; text-align:center;">
  <div style="max-width:440px; margin:0 auto; padding:32px 28px; background:#0c0816; border:1px solid #2e2150;">
    <p style="margin:0 0 18px; font-size:22px; font-weight:bold; color:#efe4ff;">MU <span style="color:#ff8fc4;">PRO</span></p>
    <h1 style="margin:0 0 12px; font-size:20px; color:#efe4ff;">${title}</h1>
    <p style="margin:0; font-size:15px; line-height:1.6;">${message}</p>
    ${form}
  </div>
</body>
</html>`;
}

function readUnsubscribeParams(req) {
  return { email: req.query.email, token: req.query.token };
}

/**
 * GET só mostra a confirmação (com botão): leitores de link e antivírus de
 * e-mail abrem os links sozinhos, e isso não pode descadastrar ninguém.
 */
function showUnsubscribe(req, res) {
  const { email, token } = readUnsubscribeParams(req);
  if (!emailCampaignService.isValidUnsubscribeToken(email, token)) {
    return res.status(400).type('html').send(renderPage('Link inválido', 'Este link de descadastro é inválido ou está incompleto.'));
  }
  const form = `
    <form method="post" style="margin:24px 0 0;">
      <button type="submit" style="padding:14px 28px; border:0; background:#9d6bff; color:#1e0b3d; font-size:15px; font-weight:bold; cursor:pointer;">Confirmar descadastro</button>
    </form>`;
  return res
    .type('html')
    .send(renderPage('Parar de receber novidades?', 'Você não vai mais receber e-mails de novidades e eventos do MU PRO. E-mails da sua conta (como redefinição de senha) continuam chegando.', form));
}

/** POST: botão da página acima e descadastro com um clique (RFC 8058). */
async function confirmUnsubscribe(req, res, next) {
  try {
    const { email, token } = readUnsubscribeParams(req);
    if (!emailCampaignService.isValidUnsubscribeToken(email, token)) {
      return res.status(400).type('html').send(renderPage('Link inválido', 'Este link de descadastro é inválido ou está incompleto.'));
    }
    await emailCampaignService.unsubscribe(email);
    return res.type('html').send(renderPage('Pronto!', 'Você não vai mais receber e-mails de novidades do MU PRO.'));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listCampaigns,
  getCampaign,
  sendTest,
  startCampaign,
  cancelCampaign,
  showUnsubscribe,
  confirmUnsubscribe,
};
