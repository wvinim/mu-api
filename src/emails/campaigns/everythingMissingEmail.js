const { escapeHtml } = require('../layout');

/**
 * Campanha para quem parou de jogar porque faltava app mobile, AFK, party com
 * senha e autoreset (novembro/2026, antes do lançamento oficial de 27/11).
 * Arte do topo publicada no site (public/img/email-tudo-que-faltava.jpg do
 * mu-front). Fonte de referência do layout: mu-front/docs/emails/tudo-que-faltava.html.
 *
 * Público: só e-mail confirmado, sem as contas de teste.
 */

const subject = '🔥 Agora tem app mobile, AFK, party com senha e autoreset no MU PRO';

const audience = Object.freeze({
  confirmedEmailOnly: true,
  excludeAccounts: Object.freeze(['texunbosum', 'testebeta', 'teste001']),
});

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
<title>Agora tem tudo que faltava no MU PRO</title>
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
    App mobile, AFK, party com senha e autoreset. Lançamento oficial 27/11 às 19h.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#06040c" style="background-color:#06040c;">
    <tr>
      <td align="center" style="padding:24px 10px;">

        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#0c0816; border:1px solid #2e2150;">

          <!-- Arte do topo -->
          <tr>
            <td style="padding:0; background-color:#06040c;">
              <a href="${site}" target="_blank" style="text-decoration:none;">
                <img src="${site}/img/email-tudo-que-faltava.jpg" width="600" alt="MU PRO · Agora tem tudo que faltava: app mobile, AFK, party com senha e autoreset" style="width:100%; max-width:600px; height:auto; color:#d6bfff; font-family:Arial, sans-serif; font-size:22px; font-weight:bold; text-align:center; background-color:#06040c;">
              </a>
            </td>
          </tr>

          <!-- Abertura -->
          <tr>
            <td class="px" style="padding:36px 44px 8px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.6; color:#c4b4e6;">
              <h1 style="margin:0 0 20px; font-family:Arial, Helvetica, sans-serif; font-size:28px; line-height:1.2; font-weight:bold; color:#efe4ff;">
                Agora tem tudo que faltava no MU PRO.
              </h1>
              <p style="margin:0 0 16px;">Olá, ${safeName}!</p>
              <p style="margin:0 0 16px;">
                Muita gente nos disse que parou de jogar porque faltava <strong style="color:#efe4ff;">versão mobile, AFK, party com senha e autoreset</strong>. Ouvimos cada pedido, e agora o servidor tem tudo isso:
              </p>
            </td>
          </tr>

          <!-- Novidades -->
          <tr>
            <td class="px" style="padding:0 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    📱 <strong style="color:#efe4ff;">App mobile</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">O app Android já está disponível, com a mesma conta e os mesmos personagens do PC.</span>
                    <a href="${site}/download#android" target="_blank" style="font-size:14px; color:#bb95ff; font-weight:bold; text-decoration:none; white-space:nowrap;">Baixar →</a>
                  </td>
                </tr>
                <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    💤 <strong style="color:#efe4ff;">AFK</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">Seu personagem continua upando mesmo com o jogo fechado.</span>
                    <a href="${site}/guias/afk" target="_blank" style="font-size:14px; color:#bb95ff; font-weight:bold; text-decoration:none; white-space:nowrap;">Ver guia →</a>
                  </td>
                </tr>
                <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    🔐 <strong style="color:#efe4ff;">Party com senha</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">Combine uma senha com os amigos e todo mundo entra na party sozinho.</span>
                    <a href="${site}/guias/party-com-senha" target="_blank" style="font-size:14px; color:#bb95ff; font-weight:bold; text-decoration:none; white-space:nowrap;">Ver guia →</a>
                  </td>
                </tr>
                <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    🔄 <strong style="color:#efe4ff;">Autoreset</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">Reseta sem sair do spot e já distribui os pontos do jeito que você configurou.</span>
                    <a href="${site}/guias/autoreset" target="_blank" style="font-size:14px; color:#bb95ff; font-weight:bold; text-decoration:none; white-space:nowrap;">Ver guia →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Lançamento -->
          <tr>
            <td class="px" style="padding:32px 44px 8px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.6; color:#c4b4e6;">
              <h2 style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif; font-size:22px; line-height:1.3; font-weight:bold; color:#efe4ff;">
                🚀 Lançamento oficial: 27/11, sexta, às 19h
              </h2>
              <p style="margin:0 0 16px;">
                O lançamento chega junto com a <strong style="color:#ff8fc4;">promo de Black Friday</strong>. E quem já tem conta não começa de mãos vazias:
              </p>
            </td>
          </tr>

          <!-- Recompensas -->
          <tr>
            <td class="px" style="padding:0 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #ff8fc4; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    🛡️ <strong style="color:#efe4ff;">Itens do personagem principal</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">O personagem com mais resets da conta mantém os itens que estiver usando até 26/11.</span>
                  </td>
                </tr>
                <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #ff8fc4; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    💎 <strong style="color:#efe4ff;">1 Jewel of Reset por reset</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">Cada reset feito no pré-lançamento vira uma Jewel of Reset.</span>
                  </td>
                </tr>
                <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #ff8fc4; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    💰 <strong style="color:#efe4ff;">Seu GOLD de volta</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">Todo GOLD adquirido no pré-lançamento estará disponível novamente em 27/11.</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Botão -->
          <tr>
            <td align="center" class="px" style="padding:32px 44px 12px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#9d6bff" style="background-color:#9d6bff;">
                    <a href="${site}/download" target="_blank" style="display:inline-block; padding:16px 40px; font-family:Arial, Helvetica, sans-serif; font-size:17px; font-weight:bold; letter-spacing:1px; color:#1e0b3d; text-decoration:none;">BAIXAR E JOGAR</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" class="px" style="padding:0 44px 36px; font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:1.6; color:#a99cc4;">
              Sua conta continua a mesma. Entre também na nossa <a href="${site}/discord" target="_blank" style="color:#7983f5; font-weight:bold; text-decoration:none;">comunidade no Discord</a> para novidades, eventos e avisos.
            </td>
          </tr>

          <!-- Rodapé -->
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
    'Agora tem tudo que faltava no MU PRO.',
    '',
    `Olá, ${name}!`,
    '',
    'Muita gente nos disse que parou de jogar porque faltava versão mobile, AFK, party com senha e autoreset. Ouvimos cada pedido, e agora o servidor tem tudo isso:',
    '',
    `📱 App mobile: o app Android já está disponível, com a mesma conta e os mesmos personagens do PC. ${appUrl}/download#android`,
    `💤 AFK: seu personagem continua upando mesmo com o jogo fechado. ${appUrl}/guias/afk`,
    `🔐 Party com senha: combine uma senha com os amigos e todo mundo entra na party sozinho. ${appUrl}/guias/party-com-senha`,
    `🔄 Autoreset: reseta sem sair do spot e já distribui os pontos do jeito que você configurou. ${appUrl}/guias/autoreset`,
    '',
    '🚀 LANÇAMENTO OFICIAL: 27/11, SEXTA, ÀS 19H',
    'O lançamento chega junto com a promo de Black Friday. E quem já tem conta não começa de mãos vazias:',
    '',
    '🛡️ Itens do personagem principal: o personagem com mais resets da conta mantém os itens que estiver usando até 26/11.',
    '💎 1 Jewel of Reset por reset: cada reset feito no pré-lançamento vira uma Jewel of Reset.',
    '💰 Seu GOLD de volta: todo GOLD adquirido no pré-lançamento estará disponível novamente em 27/11.',
    '',
    `Baixe e jogue: ${appUrl}/download`,
    `Sua conta continua a mesma. Comunidade no Discord: ${appUrl}/discord`,
    '',
    '--',
    `MU PRO · ${appUrl} · admin@mupro.vip`,
    'Você recebeu este e-mail porque tem uma conta no MU PRO.',
    `Para não receber mais novidades: ${unsubscribeUrl}`,
  ].join('\n');
}

module.exports = { subject, audience, renderHtml, renderText };
