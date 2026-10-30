const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const emailService = require('./emailService');
const emailCampaignsRepository = require('../db/emailCampaignsRepository');
const { getCampaign } = require('../emails/campaigns');

/**
 * Envio de campanhas de divulgação. Ver docs/SECTION_12_EMAIL_CAMPAIGNS.md.
 *
 * O envio roda em segundo plano dentro do próprio processo, um e-mail por
 * vez com pausa entre eles (limite do SMTP). O estado do job fica em
 * memória (instância única — mesma decisão do rate limit); o que já foi
 * enviado fica no banco, então um job interrompido (restart, cancelamento,
 * SMTP bloqueado) é retomado disparando de novo, sem duplicar.
 */

const jobs = new Map(); // campaignKey -> estado do job

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

// Chave HMAC derivada do segredo do JWT: sem env var nova. Trocar o
// JWT_ACCESS_SECRET invalida links de descadastro de e-mails antigos.
function unsubscribeKey() {
  return crypto.createHmac('sha256', env.jwt.accessSecret).update('email-unsubscribe').digest();
}

function unsubscribeToken(email) {
  return crypto.createHmac('sha256', unsubscribeKey()).update(normalizeEmail(email)).digest('base64url');
}

function isValidUnsubscribeToken(email, token) {
  if (typeof email !== 'string' || typeof token !== 'string' || !email || !token) return false;
  const expected = Buffer.from(unsubscribeToken(email));
  const received = Buffer.from(token);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function buildUnsubscribeUrl(email) {
  const normalized = normalizeEmail(email);
  const query = `email=${encodeURIComponent(normalized)}&token=${encodeURIComponent(unsubscribeToken(normalized))}`;
  return `${env.apiPublicUrl}/api/v1/email/unsubscribe?${query}`;
}

function requireCampaign(key) {
  const campaign = getCampaign(key);
  if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campanha não encontrada.');
  return campaign;
}

function requireSendingConfigured() {
  if (!emailService.isSmtpConfigured()) {
    throw new AppError(503, 'SMTP_NOT_CONFIGURED', 'SMTP não configurado: nenhum e-mail seria enviado.');
  }
  if (!env.apiPublicUrl) {
    throw new AppError(503, 'API_PUBLIC_URL_NOT_CONFIGURED', 'Configure API_PUBLIC_URL para gerar o link de descadastro.');
  }
}

function renderFor(campaign, { email, name }) {
  const unsubscribeUrl = buildUnsubscribeUrl(email);
  const fields = { name, unsubscribeUrl, appUrl: env.appUrl };
  return {
    subject: campaign.subject,
    html: campaign.renderHtml(fields),
    text: campaign.renderText(fields),
    unsubscribeUrl,
  };
}

/**
 * Destinatários pendentes: contas não banidas com e-mail, um envio por
 * e-mail (contas antigas podem dividir o mesmo), sem quem se descadastrou
 * nem quem já recebeu esta campanha.
 */
async function findPendingRecipients(campaignKey) {
  const [accounts, sent, unsubscribed] = await Promise.all([
    emailCampaignsRepository.findRecipientAccounts(),
    emailCampaignsRepository.findSentEmails(campaignKey),
    emailCampaignsRepository.findUnsubscribedEmails(),
  ]);
  const skip = new Set([...sent, ...unsubscribed].map(normalizeEmail));
  const recipients = new Map();
  for (const account of accounts) {
    const email = normalizeEmail(account.email);
    if (!email.includes('@') || skip.has(email) || recipients.has(email)) continue;
    const name = (account.displayName || '').trim() || account.username;
    recipients.set(email, { email, accountId: account.username, name });
  }
  return [...recipients.values()];
}

/** Envia a campanha para um único endereço (teste), sem registrar no banco. */
async function sendTest(campaignKey, { to, name }) {
  const campaign = requireCampaign(campaignKey);
  requireSendingConfigured();
  const message = renderFor(campaign, { email: to, name });
  await emailService.sendCampaignEmail(to, { ...message, subject: `[TESTE] ${message.subject}` });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runJob(campaignKey, campaign, job, recipients) {
  let consecutiveFailures = 0;
  for (const recipient of recipients) {
    if (job.cancelRequested) {
      job.status = 'cancelled';
      break;
    }
    try {
      const message = renderFor(campaign, recipient);
      await emailService.sendCampaignEmail(recipient.email, message);
      await emailCampaignsRepository.recordSend({ campaignKey, ...recipient, status: 'sent' });
      job.sent += 1;
      consecutiveFailures = 0;
    } catch (err) {
      job.failed += 1;
      consecutiveFailures += 1;
      logger.warn({ err, campaignKey, email: recipient.email }, 'Falha ao enviar e-mail de campanha');
      await emailCampaignsRepository
        .recordSend({ campaignKey, ...recipient, status: 'failed', error: err.message })
        .catch((recordErr) => logger.error({ err: recordErr, campaignKey }, 'Falha ao registrar envio de campanha'));
      if (consecutiveFailures >= env.emailCampaign.maxConsecutiveFailures) {
        job.status = 'aborted';
        job.error = `Envio interrompido após ${consecutiveFailures} falhas seguidas: ${err.message}`;
        break;
      }
    }
    await sleep(env.emailCampaign.delayMs);
  }
  if (job.status === 'running') job.status = 'finished';
  job.finishedAt = new Date().toISOString();
  logger.info({ campaignKey, ...job }, 'Campanha de e-mail encerrada');
}

/**
 * Dispara o envio em segundo plano e retorna logo. 409 se a campanha já
 * está enviando. Disparar de novo depois de terminar só manda para quem
 * ainda não recebeu (falhas e contas novas).
 */
async function startCampaign(campaignKey, { startedBy }) {
  const campaign = requireCampaign(campaignKey);
  requireSendingConfigured();
  if (jobs.get(campaignKey)?.status === 'running') {
    throw new AppError(409, 'CAMPAIGN_ALREADY_RUNNING', 'Esta campanha já está sendo enviada.');
  }

  const recipients = await findPendingRecipients(campaignKey);
  const job = {
    status: 'running',
    startedBy,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: recipients.length,
    sent: 0,
    failed: 0,
    error: null,
    cancelRequested: false,
  };
  jobs.set(campaignKey, job);

  runJob(campaignKey, campaign, job, recipients).catch((err) => {
    job.status = 'aborted';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
    logger.error({ err, campaignKey }, 'Campanha de e-mail abortada');
  });

  return publicJob(job);
}

/** Pede para parar depois do e-mail atual. 409 se não está enviando. */
function cancelCampaign(campaignKey) {
  requireCampaign(campaignKey);
  const job = jobs.get(campaignKey);
  if (job?.status !== 'running') {
    throw new AppError(409, 'CAMPAIGN_NOT_RUNNING', 'Esta campanha não está sendo enviada.');
  }
  job.cancelRequested = true;
}

// Cópia, para a resposta não mudar enquanto o job continua rodando.
function publicJob(job) {
  return job ? { ...job } : null;
}

/** Totais no banco + destinatários pendentes + job em andamento/último job. */
async function getCampaignStatus(campaignKey) {
  const campaign = requireCampaign(campaignKey);
  const [totals, pending] = await Promise.all([
    emailCampaignsRepository.countByStatus(campaignKey),
    findPendingRecipients(campaignKey),
  ]);
  return {
    key: campaignKey,
    subject: campaign.subject,
    totals,
    pending: pending.length,
    job: publicJob(jobs.get(campaignKey)),
  };
}

async function unsubscribe(email) {
  await emailCampaignsRepository.addUnsubscribe(normalizeEmail(email));
}

module.exports = {
  sendTest,
  startCampaign,
  cancelCampaign,
  getCampaignStatus,
  unsubscribe,
  isValidUnsubscribeToken,
  buildUnsubscribeUrl,
  findPendingRecipients,
  _jobs: jobs,
};
