const { renderEmailLayout } = require('./layout');

function passwordResetEmailTemplate({ link, ttlHours }) {
  return renderEmailLayout({
    preheader: 'Solicitação de redefinição de senha da sua conta MU PRO.',
    title: 'Redefinição de senha',
    bodyHtml: `
      <p style="margin: 0 0 12px;">Recebemos uma solicitação para redefinir a senha da sua conta.</p>
      <p style="margin: 0;">Clique no botão abaixo para escolher uma nova senha. Este link é válido por <strong>${ttlHours}h</strong> e só pode ser usado uma vez.</p>
    `,
    ctaText: 'Redefinir senha',
    ctaUrl: link,
    footerNote: 'Se você não pediu essa redefinição, ignore este e-mail — sua senha atual continua funcionando normalmente.',
  });
}

module.exports = { passwordResetEmailTemplate };
