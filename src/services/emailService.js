const fs = require('fs');
const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('../utils/logger');
const { confirmationEmailTemplate } = require('../emails/confirmationEmail');
const { passwordResetEmailTemplate } = require('../emails/passwordResetEmail');
const { giftCodeEmailTemplate } = require('../emails/giftCodeEmail');

let transporter = null;

// Retorna a config DKIM do Nodemailer, ou undefined se não configurada.
// Configuração parcial ou chave ilegível é erro de deploy — falha alto em vez
// de enviar e-mail sem assinatura sem ninguém perceber.
function buildDkimOptions() {
  const { domainName, keySelector, privateKeyPath } = env.smtp.dkim;
  if (!domainName && !keySelector && !privateKeyPath) return undefined;
  if (!domainName || !keySelector || !privateKeyPath) {
    throw new Error('DKIM parcialmente configurado: preencha DKIM_DOMAIN, DKIM_SELECTOR e DKIM_PRIVATE_KEY_PATH (ou deixe os três vazios)');
  }
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  return { domainName, keySelector, privateKey };
}

function getTransporter() {
  if (!transporter) {
    const dkim = buildDkimOptions();
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
      dkim,
    });
    logger.info({ dkim: dkim ? `${dkim.keySelector}._domainkey.${dkim.domainName}` : 'desativado' }, 'Transporte SMTP criado');
  }
  return transporter;
}

function isSmtpConfigured() {
  return Boolean(env.smtp.host);
}

async function sendMail({ to, subject, html, text, headers }) {
  if (!isSmtpConfigured()) {
    // Sem SMTP configurado (ex: dev local) — não falha o fluxo, só loga.
    logger.warn({ to, subject }, 'SMTP não configurado — e-mail não enviado (apenas logado)');
    logger.debug({ html }, 'Conteúdo do e-mail que seria enviado');
    return;
  }
  await getTransporter().sendMail({ from: env.smtp.from, to, subject, html, text, headers });
}

async function sendConfirmationEmail(to, token) {
  const link = `${env.appUrl}/confirmar-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to,
    subject: 'Confirme seu e-mail — MU PRO',
    html: confirmationEmailTemplate({ link, ttlHours: env.emailTokenTtlHours }),
  });
}

async function sendPasswordResetEmail(to, token) {
  const link = `${env.appUrl}/redefinir-senha?token=${encodeURIComponent(token)}`;
  await sendMail({
    to,
    subject: 'Redefinição de senha — MU PRO',
    html: passwordResetEmailTemplate({ link, ttlHours: env.passwordResetTokenTtlHours }),
  });
}

async function sendGiftCodeEmail(to, { code, creditsAmount }) {
  await sendMail({
    to,
    subject: 'Sua chave de presente — MU PRO',
    html: giftCodeEmailTemplate({ code, creditsAmount, redeemUrl: `${env.appUrl}/loja/creditos` }),
  });
}

/**
 * E-mail de divulgação (ver services/emailCampaignService.js). Leva versão em
 * texto puro e os cabeçalhos de descadastro com um clique (RFC 8058), que o
 * Gmail e o Yahoo exigem de envio em massa.
 */
async function sendCampaignEmail(to, { subject, html, text, unsubscribeUrl }) {
  await sendMail({
    to,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

module.exports = {
  isSmtpConfigured,
  sendConfirmationEmail,
  sendPasswordResetEmail,
  sendGiftCodeEmail,
  sendCampaignEmail,
};
