const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('../utils/logger');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
    });
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
    subject: 'Confirme seu e-mail',
    html: `<p>Confirme seu e-mail clicando no link abaixo (válido por ${env.emailTokenTtlHours}h):</p>
           <p><a href="${link}">${link}</a></p>`,
  });
}

async function sendPasswordResetEmail(to, token) {
  const link = `${env.appUrl}/redefinir-senha?token=${encodeURIComponent(token)}`;
  await sendMail({
    to,
    subject: 'Redefinição de senha',
    html: `<p>Clique no link abaixo para redefinir sua senha (válido por ${env.passwordResetTokenTtlHours}h).
           Se você não pediu isso, ignore este e-mail.</p>
           <p><a href="${link}">${link}</a></p>`,
  });
}

module.exports = { sendConfirmationEmail, sendPasswordResetEmail };
