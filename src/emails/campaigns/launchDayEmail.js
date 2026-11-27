const { escapeHtml } = require('../layout');

/**
 * Campanha da estreia: o lançamento oficial de 27/11/2026 com as novidades da
 * atualização (bosses com GOLD, ranking premiado, até 200 resets, Time
 * Collector 50, guia de spots) e a Black Friday de 50% no GOLD.
 * Arte do topo publicada no site (public/img/email-estreia.jpg do mu-front).
 * Fonte de referência do layout: mu-front/docs/emails/estreia.html.
 *
 * Público (o mesmo da tudo-que-faltava): todas as contas com e-mail,
 * confirmado ou não e banidas ou não, menos as contas de teste.
 */

const subject = ({ name }) => `Olá, ${name}! 🚀 O MU PRO está no ar, com bosses, ranking premiado e Black Friday`;

const audience = Object.freeze({
  includeBanned: true,
  excludeAccounts: Object.freeze(['testebeta', 'teste001']),
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
<title>O MU PRO está no ar</title>
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

  <!-- Pré-cabeçalho: texto que aparece ao lado do assunto na caixa de entrada -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#06040c; opacity:0;">
    Bosses com GOLD, ranking premiado e todo o GOLD com 50% off na Black Friday.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#06040c" style="background-color:#06040c;">
    <tr>
      <td align="center" style="padding:24px 10px;">

        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#0c0816; border:1px solid #2e2150;">

          <!-- Arte do topo -->
          <tr>
            <td style="padding:0; background-color:#06040c;">
              <a href="${site}" target="_blank" style="text-decoration:none;">
                <img src="${site}/img/email-estreia.jpg" width="600" alt="MU PRO · Estamos no ar! O MU PRO abriu oficialmente no PC e no celular Android" style="width:100%; max-width:600px; height:auto; color:#d6bfff; font-family:Arial, sans-serif; font-size:22px; font-weight:bold; text-align:center; background-color:#06040c;">
              </a>
            </td>
          </tr>

          <!-- Abertura -->
          <tr>
            <td class="px" style="padding:36px 44px 8px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.6; color:#c4b4e6;">
              <h1 style="margin:0 0 20px; font-family:Arial, Helvetica, sans-serif; font-size:28px; line-height:1.2; font-weight:bold; color:#efe4ff;">
                O MU PRO está no ar!
              </h1>
              <p style="margin:0 0 16px;">Olá, ${safeName}!</p>
              <p style="margin:0 0 16px;">
                O MU PRO abriu oficialmente em <strong style="color:#efe4ff;">27/11</strong> e os servidores já estão no ar. Dá para jogar no <strong style="color:#efe4ff;">PC e no celular Android</strong>, com a mesma conta e os mesmos personagens.
              </p>
              <p style="margin:0 0 16px;">E a estreia chegou cheia de novidades:</p>
            </td>
          </tr>

          <!-- Novidades -->
          <tr>
            <td class="px" style="padding:0 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    🐲 <strong style="color:#efe4ff;">Bosses com 3 GOLD no último golpe</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">A Phoenix nasce em Icarus (13:25 e 21:25) e a Hydra em Atlans (14:00 e 22:00). Quem der o último golpe ganha 3 GOLD, além do drop. Só no server MU PRO, e até 15/12 eles estão com ataque e defesa reduzidos.</span>
                    <a href="${site}/guias/bosses" target="_blank" style="font-size:14px; color:#bb95ff; font-weight:bold; text-decoration:none; white-space:nowrap;">Ver guia →</a>
                  </td>
                </tr>
                <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    🏆 <strong style="color:#efe4ff;">Ranking premiado</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">O 1º lugar em resets ganha GOLD na conta: 3 GOLD no dia, 21 GOLD na semana e 90 GOLD no mês.</span>
                    <a href="${site}/ranking" target="_blank" style="font-size:14px; color:#bb95ff; font-weight:bold; text-decoration:none; white-space:nowrap;">Ver ranking →</a>
                  </td>
                </tr>
                <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    📊 <strong style="color:#efe4ff;">Até 200 resets, com pontos iguais para todos</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">Os pontos por reset agora são os mesmos em todos os planos: 450 do 1 ao 50, 400 do 51 ao 100 e 330 do 101 ao 200.</span>
                    <a href="${site}/info#rates" target="_blank" style="font-size:14px; color:#bb95ff; font-weight:bold; text-decoration:none; white-space:nowrap;">Ver rates →</a>
                  </td>
                </tr>
                <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    ⏳ <strong style="color:#efe4ff;">Time Collector mais barato</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">Agora são 50 resets por 1 Jewel of Excellent, a joia que adiciona uma option excellent ao item.</span>
                    <a href="${site}/guias/jewel-of-excellent" target="_blank" style="font-size:14px; color:#bb95ff; font-weight:bold; text-decoration:none; white-space:nowrap;">Ver guia →</a>
                  </td>
                </tr>
                <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.5; color:#c4b4e6;">
                    🗺️ <strong style="color:#efe4ff;">Guia de spots</strong><br>
                    <span style="font-size:14px; color:#a99cc4;">Os 123 spots de monstros em 17 mapas, com coordenada, nível e busca pelo nome do monstro.</span>
                    <a href="${site}/guias/spots" target="_blank" style="font-size:14px; color:#bb95ff; font-weight:bold; text-decoration:none; white-space:nowrap;">Ver guia →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Black Friday -->
          <tr>
            <td class="px" style="padding:32px 44px 8px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.6; color:#c4b4e6;">
              <h2 style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif; font-size:22px; line-height:1.3; font-weight:bold; color:#efe4ff;">
                🏷️ Black Friday: GOLD com <span style="color:#ff8fc4;">50% off</span>
              </h2>
              <p style="margin:0 0 16px;">Todos os pacotes de GOLD da loja estão pela metade do preço:</p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:0 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#150e26; border-left:3px solid #ff8fc4;">
                <tr>
                  <td style="padding:14px 18px 6px; font-family:Arial, Helvetica, sans-serif; font-size:16px; color:#efe4ff; font-weight:bold;">💰 90 GOLD</td>
                  <td align="right" style="padding:14px 18px 6px; font-family:Arial, Helvetica, sans-serif; font-size:16px; white-space:nowrap;"><span style="color:#8070a0; text-decoration:line-through;">R$ 30</span>&nbsp; <strong style="color:#ff8fc4;">R$ 15</strong></td>
                </tr>
                <tr>
                  <td style="padding:6px 18px; font-family:Arial, Helvetica, sans-serif; font-size:16px; color:#efe4ff; font-weight:bold;">💰 210 GOLD</td>
                  <td align="right" style="padding:6px 18px; font-family:Arial, Helvetica, sans-serif; font-size:16px; white-space:nowrap;"><span style="color:#8070a0; text-decoration:line-through;">R$ 60</span>&nbsp; <strong style="color:#ff8fc4;">R$ 30</strong></td>
                </tr>
                <tr>
                  <td style="padding:6px 18px 14px; font-family:Arial, Helvetica, sans-serif; font-size:16px; color:#efe4ff; font-weight:bold;">💰 340 GOLD</td>
                  <td align="right" style="padding:6px 18px 14px; font-family:Arial, Helvetica, sans-serif; font-size:16px; white-space:nowrap;"><span style="color:#8070a0; text-decoration:line-through;">R$ 90</span>&nbsp; <strong style="color:#ff8fc4;">R$ 45</strong></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:12px 44px 0; font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:1.6; color:#a99cc4;">
              Pagamento por Pix, e dá para comprar de presente para um amigo.
              <a href="${site}/loja/creditos" target="_blank" style="color:#ff8fc4; font-weight:bold; text-decoration:none; white-space:nowrap;">Ver pacotes →</a>
            </td>
          </tr>

          <!-- Pré-lançamento -->
          <tr>
            <td class="px" style="padding:32px 44px 8px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:1.6; color:#c4b4e6;">
              <h2 style="margin:0 0 12px; font-family:Arial, Helvetica, sans-serif; font-size:22px; line-height:1.3; font-weight:bold; color:#efe4ff;">
                🎁 Jogou o pré-lançamento?
              </h2>
              <p style="margin:0 0 16px;">Você não começa do zero:</p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:0 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:16px 18px; background-color:#150e26; border-left:3px solid #9d6bff; font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:1.7; color:#a99cc4;">
                    🛡️ O personagem com mais resets da conta mantém os itens que estava usando.<br>
                    💎 Cada reset feito no pré-lançamento virou 1 Jewel of Reset.<br>
                    💰 Todo GOLD adquirido no pré-lançamento está disponível novamente.
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
              Veja todas as mudanças em <a href="${site}/novidades" target="_blank" style="color:#bb95ff; font-weight:bold; text-decoration:none;">Novidades</a> e entre na nossa <a href="${site}/discord" target="_blank" style="color:#7983f5; font-weight:bold; text-decoration:none;">comunidade no Discord</a> para eventos e avisos.
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
    'O MU PRO está no ar!',
    '',
    `Olá, ${name}!`,
    '',
    'O MU PRO abriu oficialmente em 27/11 e os servidores já estão no ar. Dá para jogar no PC e no celular Android, com a mesma conta e os mesmos personagens.',
    '',
    'E a estreia chegou cheia de novidades:',
    '',
    `🐲 Bosses com 3 GOLD no último golpe: a Phoenix nasce em Icarus (13:25 e 21:25) e a Hydra em Atlans (14:00 e 22:00). Quem der o último golpe ganha 3 GOLD, além do drop. Só no server MU PRO, e até 15/12 eles estão com ataque e defesa reduzidos. ${appUrl}/guias/bosses`,
    `🏆 Ranking premiado: o 1º lugar em resets ganha GOLD na conta: 3 GOLD no dia, 21 GOLD na semana e 90 GOLD no mês. ${appUrl}/ranking`,
    `📊 Até 200 resets, com pontos iguais para todos: 450 do 1 ao 50, 400 do 51 ao 100 e 330 do 101 ao 200, em todos os planos. ${appUrl}/info#rates`,
    `⏳ Time Collector mais barato: agora são 50 resets por 1 Jewel of Excellent, a joia que adiciona uma option excellent ao item. ${appUrl}/guias/jewel-of-excellent`,
    `🗺️ Guia de spots: os 123 spots de monstros em 17 mapas, com coordenada, nível e busca pelo nome do monstro. ${appUrl}/guias/spots`,
    '',
    '🏷️ BLACK FRIDAY: GOLD COM 50% OFF',
    'Todos os pacotes de GOLD da loja estão pela metade do preço:',
    '90 GOLD: de R$ 30 por R$ 15',
    '210 GOLD: de R$ 60 por R$ 30',
    '340 GOLD: de R$ 90 por R$ 45',
    `Pagamento por Pix, e dá para comprar de presente para um amigo. ${appUrl}/loja/creditos`,
    '',
    '🎁 JOGOU O PRÉ-LANÇAMENTO? Você não começa do zero:',
    '🛡️ O personagem com mais resets da conta mantém os itens que estava usando.',
    '💎 Cada reset feito no pré-lançamento virou 1 Jewel of Reset.',
    '💰 Todo GOLD adquirido no pré-lançamento está disponível novamente.',
    '',
    `Baixe e jogue: ${appUrl}/download`,
    `Todas as mudanças: ${appUrl}/novidades`,
    `Comunidade no Discord: ${appUrl}/discord`,
    '',
    '--',
    `MU PRO · ${appUrl} · admin@mupro.vip`,
    'Você recebeu este e-mail porque tem uma conta no MU PRO.',
    `Para não receber mais novidades: ${unsubscribeUrl}`,
  ].join('\n');
}

module.exports = { subject, audience, renderHtml, renderText };
