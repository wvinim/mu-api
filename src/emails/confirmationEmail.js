const { renderEmailLayout } = require('./layout');

function confirmationEmailTemplate({ link, ttlHours }) {
  return renderEmailLayout({
    preheader: 'Confirme seu e-mail para ativar sua conta no MU PRO.',
    title: 'Confirme seu e-mail',
    bodyHtml: `
      <p style="margin: 0 0 12px;">Falta pouco! Clique no botão abaixo para confirmar seu e-mail e ativar sua conta.</p>
      <p style="margin: 0;">Este link é válido por <strong>${ttlHours}h</strong>.</p>
    `,
    ctaText: 'Confirmar e-mail',
    ctaUrl: link,
    footerNote: 'Se você não criou uma conta no MU PRO, pode ignorar este e-mail com segurança.',
  });
}

module.exports = { confirmationEmailTemplate };
