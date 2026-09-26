const fs = require('fs');
const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('../utils/logger');
const { confirmationEmailTemplate } = require('../emails/confirmationEmail');
const { passwordResetEmailTemplate } = require('../emails/passwordResetEmail');

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

async function sendMail({ to, subject, html }) {
  if (!env.smtp.host) {
    // Sem SMTP configurado (ex: dev local) — não falha o fluxo, só loga.
    logger.warn({ to, subject }, 'SMTP não configurado — e-mail não enviado (apenas logado)');
    logger.debug({ html }, 'Conteúdo do e-mail que seria enviado');
    return;
  }
  await getTransporter().sendMail({ from: env.smtp.from, to, subject, html });
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

module.exports = { sendConfirmationEmail, sendPasswordResetEmail };
