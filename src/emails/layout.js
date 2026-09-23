/**
 * Layout base dos e-mails transacionais, espelhando o visual do site
 * (mupro.vip): fundo escuro, acentos dourado/laranja, tipografia
 * Saira Condensed (títulos) + Inter (corpo). Tabelas + estilos inline
 * porque é o que sobrevive em clientes de e-mail (Outlook, Gmail etc).
 */

const COLORS = {
  bg: '#070402',
  panel: '#120b08',
  panelBorder: 'rgba(255, 90, 43, 0.22)',
  text: '#f2e9df',
  textMuted: 'rgba(242, 233, 223, 0.65)',
  goldLight: '#ffe9bd',
  gold: '#f0a830',
  gradientFrom: '#ffd98c',
  gradientTo: '#ff8a5c',
  buttonText: '#070402',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {object} opts
 * @param {string} opts.preheader - texto curto de preview (invisível no corpo)
 * @param {string} opts.title - título dentro do card (ex: "Confirme seu e-mail")
 * @param {string} opts.bodyHtml - parágrafos já em HTML (será inserido cru)
 * @param {string} [opts.ctaText] - texto do botão principal
 * @param {string} [opts.ctaUrl] - link do botão principal
 * @param {string} [opts.footerNote] - nota extra no rodapé do card (ex: aviso de segurança)
 */
function renderEmailLayout({ preheader = '', title, bodyHtml, ctaText, ctaUrl, footerNote }) {
  const year = new Date().getFullYear();

  const button = ctaText && ctaUrl
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0 8px;">
        <tr>
          <td bgcolor="${COLORS.gradientTo}" style="border-radius: 8px;">
            <a href="${escapeHtml(ctaUrl)}" target="_blank"
               style="display: inline-block; padding: 13px 28px; font-family: 'Saira Condensed', Arial, sans-serif;
                      font-size: 15px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
                      text-decoration: none; color: ${COLORS.buttonText}; border-radius: 8px;
                      background-image: linear-gradient(135deg, ${COLORS.gradientFrom}, ${COLORS.gradientTo});">
              ${escapeHtml(ctaText)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin: 4px 0 0; font-size: 12px; line-height: 1.6; color: ${COLORS.textMuted}; word-break: break-all;">
        Se o botão não funcionar, copie e cole este link no navegador:<br>
        <a href="${escapeHtml(ctaUrl)}" target="_blank" style="color: ${COLORS.gold};">${escapeHtml(ctaUrl)}</a>
      </p>`
    : '';

  const footer = footerNote
    ? `<p style="margin: 24px 0 0; font-size: 12px; line-height: 1.6; color: ${COLORS.textMuted};">${footerNote}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style>
  @media only screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .panel { padding: 28px 20px !important; }
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: ${COLORS.bg}; font-family: 'Inter', Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLORS.bg};">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width: 560px; max-width: 100%;">
          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <span style="font-family: 'Saira Condensed', Arial, sans-serif; font-size: 22px; font-weight: 900; letter-spacing: 1px;">
                <span style="color: ${COLORS.goldLight};">MU</span><span style="color: ${COLORS.gold};"> PRO</span>
              </span>
            </td>
          </tr>
          <tr>
            <td class="panel" bgcolor="${COLORS.panel}"
                style="background-color: ${COLORS.panel}; border: 1px solid ${COLORS.panelBorder}; border-radius: 12px; padding: 36px 40px;">
              <h1 style="margin: 0 0 16px; font-family: 'Saira Condensed', Arial, sans-serif; font-size: 24px;
                         font-weight: 700; color: ${COLORS.goldLight};">
                ${escapeHtml(title)}
              </h1>
              <div style="font-size: 14px; line-height: 1.7; color: ${COLORS.text};">
                ${bodyHtml}
              </div>
              ${button}
              ${footer}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top: 24px;">
              <p style="margin: 0; font-size: 12px; color: ${COLORS.textMuted};">
                MU PRO &middot; Season 2.5 &middot; &copy; ${year}
              </p>
              <p style="margin: 4px 0 0; font-size: 12px; color: ${COLORS.textMuted};">
                Você recebeu este e-mail porque uma ação foi solicitada na sua conta do MU PRO.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { renderEmailLayout, COLORS };
