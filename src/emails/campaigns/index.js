/**
 * Campanhas de divulgação disponíveis para POST /admin/email-campaigns/:key.
 * A chave vira o CampaignKey em WebEmailCampaignSends (máx. 40 caracteres):
 * nunca renomeie uma chave já enviada, senão quem já recebeu recebe de novo.
 *
 * Cada campanha: { subject (texto ou ({ name }) => texto), renderHtml({ name, unsubscribeUrl, appUrl }),
 * renderText(mesmos campos), audience? }. `audience` (opcional) restringe
 * os destinatários: { includeBanned, confirmedEmailOnly, excludeAccounts }.
 */
const CAMPAIGNS = Object.freeze({
  inauguracao: require('./launchWeekEmail'),
  'tudo-que-faltava': require('./everythingMissingEmail'),
});

function getCampaign(key) {
  return Object.prototype.hasOwnProperty.call(CAMPAIGNS, key) ? CAMPAIGNS[key] : null;
}

function listCampaignKeys() {
  return Object.keys(CAMPAIGNS);
}

module.exports = { getCampaign, listCampaignKeys };
