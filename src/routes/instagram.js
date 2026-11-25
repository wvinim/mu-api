const crypto = require('crypto');
const { Router } = require('express');
const env = require('../config/env');
const logger = require('../utils/logger');
const verifyInstagramSignature = require('../middlewares/verifyInstagramSignature');

/**
 * Webhook do Instagram — FASE DE TESTE (docs/SECTION_15_INSTAGRAM.md).
 * Só registra no log o que chega e tenta consultar @/seguidores de quem
 * enviou. Não grava no banco e não credita nada.
 */
const router = Router();

// Verificação do painel da Meta: devolve hub.challenge se o token bater.
router.get('/instagram/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const expected = env.instagram.verifyToken;

  const tokenOk =
    expected &&
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));

  if (mode === 'subscribe' && tokenOk) {
    logger.info('instagram webhook: verificação aceita');
    return res.status(200).type('text/plain').send(challenge);
  }
  logger.warn({ mode }, 'instagram webhook: verificação recusada');
  return res.sendStatus(403);
});

async function fetchProfile(igsid) {
  const token = env.instagram.accessToken;
  if (!token) return { skipped: 'INSTAGRAM_ACCESS_TOKEN vazio' };
  const url = new URL(`https://${env.instagram.graphHost}/${encodeURIComponent(igsid)}`);
  url.searchParams.set('fields', 'username,name,follower_count,is_user_follow_business,is_verified_user');
  url.searchParams.set('access_token', token);
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = await resp.json().catch(() => null);
    return { status: resp.status, body };
  } catch (err) {
    return { error: err.message };
  }
}

async function inspectPayload(payload) {
  const entries = Array.isArray(payload && payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const ev of events) {
      const attachments = (ev.message && ev.message.attachments) || [];
      const senderId = ev.sender && ev.sender.id;
      const summary = {
        entryId: entry.id,
        senderId,
        recipientId: ev.recipient && ev.recipient.id,
        mid: ev.message && ev.message.mid,
        text: ev.message && ev.message.text,
        isEcho: Boolean(ev.message && ev.message.is_echo),
        attachmentTypes: attachments.map((a) => a.type),
      };
      // Mensagens "eco" são as que o próprio perfil enviou: sem consulta.
      const profile = senderId && !summary.isEcho ? await fetchProfile(senderId) : null;
      logger.info({ instagram: summary, profile }, 'instagram webhook: evento');
    }
  }
}

router.post('/instagram/webhook', verifyInstagramSignature, (req, res) => {
  // Payload completo no log: é o que queremos ver nesta fase de teste.
  logger.info({ instagramPayload: req.body }, 'instagram webhook: recebido');
  // 200 imediato (a Meta reenvia se demorar); a consulta de perfil roda depois.
  res.sendStatus(200);
  inspectPayload(req.body).catch((err) => logger.error({ err }, 'instagram webhook: falha ao inspecionar'));
});

module.exports = router;
