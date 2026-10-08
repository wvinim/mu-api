const { renderEmailLayout, COLORS } = require('./layout');

// `code` só tem [A-Z0-9-] (gerado por utils/giftCode) — seguro inserir no HTML.
function giftCodeEmailTemplate({ code, creditsAmount, redeemUrl }) {
  const amount = Number(creditsAmount).toLocaleString('pt-BR');
  return renderEmailLayout({
    preheader: `Sua chave de presente de ${amount} de gold está pronta.`,
    title: 'Seu presente está pronto',
    bodyHtml: `
      <p style="margin: 0 0 12px;">Pagamento confirmado! Esta é a chave de <strong>${amount} de gold</strong>:</p>
      <p style="margin: 0 0 16px; text-align: center;">
        <span style="display: inline-block; padding: 12px 18px; border: 1px solid ${COLORS.gold}; font-family: 'Courier New', monospace; font-size: 20px; font-weight: bold; letter-spacing: 2px; color: ${COLORS.goldLight};">${code}</span>
      </p>
      <p style="margin: 0 0 12px;">Entregue a chave para quem vai receber o presente. Ela é resgatada na página de compra de gold do site, com a conta que vai ficar com o gold, e só pode ser usada uma vez.</p>
      <p style="margin: 0;">A chave não expira, e você pode consultá-la a qualquer momento em <strong>Meus presentes</strong>, na mesma página.</p>
    `,
    ctaText: 'Ir para a página de resgate',
    ctaUrl: redeemUrl,
    footerNote: 'Trate a chave como dinheiro: quem tiver a chave pode resgatar o gold.',
  });
}

module.exports = { giftCodeEmailTemplate };
