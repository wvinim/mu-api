const { escapeHtml } = require('../layout');

/**
 * Campanha da semana de inauguração (30/10 a 05/11/2026). HTML próprio, sem
 * o layout transacional: segue o visual atual do site (paleta ametista +
 * magenta) e usa só imagem já publicada no site (og-image.jpg).
 * Fonte de referência do layout: mu-front/docs/emails/inauguracao.html.
 */

const subject = '🔥 Começou! Mega Vip grátis e festa todo dia às 20h no MU PRO';

function renderHtml({ name, unsubscribeUrl, appUrl }) {
  const safeName = escapeHtml(name);
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl);
  const site = escapeHtml(appUrl);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Começou! Semana de inauguração do MU PRO</title>
<style>
  body { margin: 0; padding: 0; width: 100% !important; background-color: #06040c; }
  table { border-collapse: collapse; }
  img { border: 0; outline: none; text-decoration: none; display: block; }
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#06040c;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#06040c; opacity:0;">
    O MU PRO está no ar! Mega Vip grátis por 3 dias e festa todo dia às 20h.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#06040c" style="background-color:#06040c;">
    <tr>
      <td align="center" style="padding:24px 10px;">

        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#0c0816; border:1px solid #2e2150;">

          <tr>
            <td style="padding:0; background-color:#06040c;">
              <a href="${site}" target="_blank" style="text-decoration:none;">
                <img src="${site}/og-image.jpg" width="600" alt="MU PRO · MU Online Season 2.5" style="width:100%; max-width:600px; height:auto; color:#d6bfff; font-family:Arial, sans-serif; font-size:24px; font-weight:bold; text-align:center; background-color:#06040c;">
              </a>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:36px 44px 8px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.6; color:#c4b4e6;">
              <p style="margin:0 0 6px; font-size:13px; font-weight:bold; letter-spacing:3px; text-transform:uppercase; color:#ff8fc4;">
                Semana de inauguração · 30/10 a 05/11
              </p>
              <h1 style="margin:0 0 20px; font-family:Arial, Helvetica, sans-serif; font-size:28px; line-height:1.2; font-weight:bold; color:#efe4ff;">
                Começou! O MU PRO está no ar.
              </h1>
              <p style="margin:0 0 16px;">Olá, ${safeName}!</p>
              <p style="margin:0 0 16px;">
                O beta acabou e o servidor está <strong style="color:#efe4ff;">oficialmente aberto</strong>. Todo mundo começa do zero e o ranking está em aberto: os primeiros lugares da história ainda não têm dono.
              </p>
              <p style="margin:0 0 12px;">Para celebrar, durante a semana de inauguração:</p>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:0 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    👑 <strong style="color:#efe4ff;">Mega Vip grátis por 3 dias</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">Tudo do plano mais alto, inclusive o Mega Autopick.</span>
                  </td>
                </tr>
                <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #ff8fc4; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    🎉 <strong style="color:#efe4ff;">Festa todo dia às 20h</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">Encontro diário no jogo a semana inteira. Chama a guild!</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" class="px" style="padding:32px 44px 12px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#9d6bff" style="background-color:#9d6bff;">
                    <a href="${site}/download" target="_blank" style="display:inline-block; padding:16px 40px; font-family:Arial, Helvetica, sans-serif; font-size:17px; font-weight:bold; letter-spacing:1px; color:#1e0b3d; text-decoration:none;">BAIXAR E JOGAR AGORA</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" class="px" style="padding:0 44px 36px; font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:1.6; color:#a99cc4;">
              Entre também no nosso <a href="https://chat.whatsapp.com/G20yTj1ZTEyATF1vnTHa62" target="_blank" style="color:#4ade80; font-weight:bold; text-decoration:none;">grupo do WhatsApp</a> para novidades, eventos e avisos.
            </td>
          </tr>

          <tr>
            <td class="px" align="center" style="padding:22px 44px 26px; background-color:#08050f; border-top:1px solid #2e2150; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:1.6; color:#8070a0;">
              <a href="${site}" target="_blank" style="color:#bb95ff; text-decoration:none;">mupro.vip</a>
              &nbsp;·&nbsp;
              <a href="${site}/contato" target="_blank" style="color:#bb95ff; text-decoration:none;">Suporte</a>
              &nbsp;·&nbsp;
              <a href="mailto:admin@mupro.vip" style="color:#bb95ff; text-decoration:none;">admin@mupro.vip</a>
              <br>
              Você recebeu este e-mail porque tem uma conta no MU PRO.
              <a href="${safeUnsubscribeUrl}" target="_blank" style="color:#8070a0; text-decoration:underline;">Não quero mais receber novidades</a>.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderText({ name, unsubscribeUrl, appUrl }) {
  return [
    'SEMANA DE INAUGURAÇÃO · 30/10 A 05/11',
    'Começou! O MU PRO está no ar.',
    '',
    `Olá, ${name}!`,
    '',
    'O beta acabou e o servidor está oficialmente aberto. Todo mundo começa do zero e o ranking está em aberto: os primeiros lugares da história ainda não têm dono.',
    '',
    'Para celebrar, durante a semana de inauguração:',
    '',
    '👑 Mega Vip grátis por 3 dias: tudo do plano mais alto, inclusive o Mega Autopick.',
    '🎉 Festa todo dia às 20h: encontro diário no jogo a semana inteira. Chama a guild!',
    '',
    `Baixe e jogue agora: ${appUrl}/download`,
    'Grupo do WhatsApp: https://chat.whatsapp.com/G20yTj1ZTEyATF1vnTHa62',
    '',
    '--',
    `MU PRO · ${appUrl} · admin@mupro.vip`,
    'Você recebeu este e-mail porque tem uma conta no MU PRO.',
    `Para não receber mais novidades: ${unsubscribeUrl}`,
  ].join('\n');
}

module.exports = { subject, renderHtml, renderText };
