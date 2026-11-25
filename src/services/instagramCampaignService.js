const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../utils/logger');
const repo = require('../db/instagramRepository');
const graph = require('./instagramGraph');
const auditLog = require('../db/auditLogRepository');

/**
 * Campanha de story no Instagram (docs/SECTION_15_INSTAGRAM.md).
 *
 * 1. O jogador gera um código no site e manda no Direct do @muproserver →
 *    o webhook vincula o IGSID à conta (prova que é dono do @).
 * 2. Quando chega um story_mention de um IGSID vinculado, com pelo menos
 *    INSTAGRAM_MIN_FOLLOWERS seguidores e nunca premiado → credita o gold.
 * 3. Um story postado antes do vínculo (até INSTAGRAM_RETROACTIVE_DAYS) é
 *    premiado quando o vínculo acontece.
 *
 * Respostas no Direct são enviadas depois do processamento e nunca
 * derrubam o webhook. O login da conta do jogo nunca vai no Direct.
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I
const CODE_REGEX = /MUPRO[\s-]*([A-Z2-9]{6})\b/i;

function generateCode() {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `MUPRO-${suffix}`;
}

/** Extrai e normaliza um código MUPRO-XXXXXX de um texto livre do Direct. */
function extractCode(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(CODE_REGEX);
  return match ? `MUPRO-${match[1].toUpperCase()}` : null;
}

function isActiveFor(username) {
  const cfg = env.instagram;
  return cfg.campaignEnabled || (Boolean(username) && cfg.testers.includes(username));
}

function panelUrl() {
  return `${env.appUrl.replace(/\/+$/, '')}/instagram`;
}

const messages = {
  linked: () =>
    `✅ Instagram vinculado à sua conta do MU PRO! Agora poste um story marcando @${env.instagram.handle} ` +
    `para ganhar ${env.instagram.rewardCash} gold.`,
  linkedAlreadyRewarded: () =>
    '✅ Instagram vinculado à sua conta do MU PRO! Este Instagram já recebeu o prêmio da campanha, então não há novo gold.',
  invalidCode: () => `❌ Código inválido ou expirado. Gere um novo em ${panelUrl()} e envie aqui de novo.`,
  igsidTaken: () =>
    '⚠️ Este Instagram já está vinculado a outra conta do MU PRO. Para trocar, desvincule na outra conta primeiro.',
  unlinked: () =>
    `👀 Vimos sua marcação! Para ganhar ${env.instagram.rewardCash} gold, vincule este Instagram em ${panelUrl()} ` +
    `em até ${env.instagram.retroactiveDays} dias.`,
  alreadyRewarded: () => 'Este Instagram já recebeu o prêmio da campanha 😉 Obrigado por divulgar o MU PRO!',
  lowFollowers: () =>
    `Para participar, seu Instagram precisa ter pelo menos ${env.instagram.minFollowers} seguidores. ` +
    `Quando chegar lá, poste outro story marcando @${env.instagram.handle}!`,
  rewarded: () =>
    `🎉 Pronto! ${env.instagram.rewardCash} gold foram creditados na sua conta do MU PRO. Obrigado por divulgar!`,
};

// ---------------------------------------------------------------- site

async function createLinkCode(username) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateCode();
    try {
      const expiresAt = await repo.createLinkCode(username, code, env.instagram.linkCodeTtlMinutes);
      return { code, expiresAt, instagramHandle: env.instagram.handle };
    } catch (err) {
      if (!repo.isUniqueViolation(err)) throw err;
    }
  }
  throw new Error('Não foi possível gerar um código de vínculo único');
}

/** Dados públicos da campanha (hotsite, sem login). */
function getPublicInfo() {
  const cfg = env.instagram;
  return {
    enabled: cfg.campaignEnabled,
    instagramHandle: cfg.handle,
    rewardCash: cfg.rewardCash,
    minFollowers: cfg.minFollowers,
    retroactiveDays: cfg.retroactiveDays,
  };
}

async function getStatus(username) {
  const cfg = env.instagram;
  const base = {
    campaignEnabled: isActiveFor(username),
    instagramHandle: cfg.handle,
    rewardCash: cfg.rewardCash,
    minFollowers: cfg.minFollowers,
    retroactiveDays: cfg.retroactiveDays,
    link: null,
    reward: null,
    lastMention: null,
  };
  const link = await repo.findLinkByUsername(username);
  if (!link) return base;

  const [reward, lastMention] = await Promise.all([
    repo.findRewardByIgsid(link.igsid),
    repo.findLastMention(link.igsid),
  ]);
  return {
    ...base,
    link: { igUsername: link.igUsername, linkedAt: link.linkedAt },
    reward: reward
      ? { amount: reward.amount, createdAt: reward.createdAt, toThisAccount: reward.username === username }
      : null,
    lastMention: lastMention
      ? { status: lastMention.status, followerCount: lastMention.followerCount, createdAt: lastMention.createdAt }
      : null,
  };
}

async function unlink(username) {
  return repo.deleteLink(username);
}

// ------------------------------------------------------------- webhook

/**
 * Tenta premiar uma menção já gravada, de um IGSID vinculado a `username`.
 * Lança erro se a consulta de perfil falhar (o webhook responde 500 e a
 * Meta reenvia; a menção fica 'profile_error' e é reprocessada).
 */
async function rewardFlow({ mid, igsid, username, replies }) {
  if (!isActiveFor(username)) {
    await repo.updateMention(mid, { status: 'disabled', username });
    return;
  }

  if (await repo.findRewardByIgsid(igsid)) {
    await repo.updateMention(mid, { status: 'already_rewarded', username });
    replies.push({ igsid, text: messages.alreadyRewarded() });
    return;
  }

  let profile;
  try {
    profile = await graph.fetchProfile(igsid);
  } catch (err) {
    await repo.updateMention(mid, { status: 'profile_error', username });
    throw err;
  }

  if (profile.followerCount === null || profile.followerCount < env.instagram.minFollowers) {
    await repo.updateMention(mid, {
      status: 'low_followers',
      username,
      igUsername: profile.username,
      followerCount: profile.followerCount,
    });
    replies.push({ igsid, text: messages.lowFollowers() });
    return;
  }

  const result = await repo.rewardMention({
    mid,
    igsid,
    username,
    igUsername: profile.username,
    followerCount: profile.followerCount,
    amount: env.instagram.rewardCash,
  });

  if (result === 'rewarded') {
    await auditLog.record({
      accountId: username,
      username,
      eventType: 'instagram.story_reward',
      success: true,
      details: {
        igsid,
        igUsername: profile.username,
        followerCount: profile.followerCount,
        amount: env.instagram.rewardCash,
      },
    });
    logger.info({ username, igsid, amount: env.instagram.rewardCash }, 'instagram: gold creditado');
    replies.push({ igsid, text: messages.rewarded() });
  } else {
    await repo.updateMention(mid, { status: 'already_rewarded', username });
    replies.push({ igsid, text: messages.alreadyRewarded() });
  }
}

async function handleMention({ igsid, mid, mediaUrl, replies }) {
  const { inserted, status } = await repo.insertMention({ mid, igsid, mediaUrl });
  // Reenvio da Meta de algo já resolvido: nada a fazer.
  if (!inserted && status !== 'received' && status !== 'profile_error') return;

  const link = await repo.findLinkByIgsid(igsid);
  if (!link) {
    if (env.instagram.campaignEnabled) {
      await repo.updateMention(mid, { status: 'unlinked' });
      replies.push({ igsid, text: messages.unlinked() });
    } else {
      await repo.updateMention(mid, { status: 'disabled' });
    }
    return;
  }
  await rewardFlow({ mid, igsid, username: link.username, replies });
}

async function handleLinkMessage({ igsid, code, replies }) {
  let igUsername = null;
  try {
    igUsername = (await graph.fetchProfile(igsid)).username;
  } catch (err) {
    logger.warn({ err: err.message, status: err.status }, 'instagram: perfil indisponível no vínculo');
  }

  const { result, username } = await repo.consumeLinkCode(code, igsid, igUsername);

  if (result === 'invalid' || result === 'expired') {
    replies.push({ igsid, text: messages.invalidCode() });
    return;
  }
  if (result === 'igsid_taken') {
    replies.push({ igsid, text: messages.igsidTaken() });
    return;
  }

  if (result === 'linked') {
    await auditLog.record({
      accountId: username,
      username,
      eventType: 'instagram.link',
      success: true,
      details: { igsid, igUsername },
    });
  }

  const alreadyRewarded = Boolean(await repo.findRewardByIgsid(igsid));
  replies.push({ igsid, text: alreadyRewarded ? messages.linkedAlreadyRewarded() : messages.linked() });

  if (!alreadyRewarded && isActiveFor(username)) {
    const pending = await repo.findRetroactiveMention(igsid, env.instagram.retroactiveDays);
    if (pending) await rewardFlow({ mid: pending.mid, igsid, username, replies });
  }
}

async function sendReplies(igAccountId, replies) {
  for (const { igsid, text } of replies) {
    try {
      await graph.sendText(igAccountId, igsid, text);
    } catch (err) {
      logger.warn({ err: err.message, status: err.status, graphError: err.body }, 'instagram: falha ao responder no Direct');
    }
  }
}

/**
 * Processa o corpo (já com assinatura validada) do webhook `messages`.
 * Erros de banco/perfil propagam: o webhook responde 500 e a Meta reenvia
 * (tudo aqui é idempotente por mid / código usado).
 */
async function handleWebhook(payload) {
  const entries = Array.isArray(payload && payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const igAccountId = entry && entry.id;
    const events = Array.isArray(entry && entry.messaging) ? entry.messaging : [];
    const replies = [];

    for (const ev of events) {
      const message = ev && ev.message;
      const igsid = ev && ev.sender && ev.sender.id;
      if (!message || !igsid || message.is_echo || message.is_deleted) continue;
      if (igAccountId && igsid === igAccountId) continue;

      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      const mention = attachments.find((a) => a && a.type === 'story_mention');

      if (mention && message.mid) {
        logger.info({ igsid }, 'instagram: story_mention recebido');
        await handleMention({
          igsid: String(igsid),
          mid: String(message.mid),
          mediaUrl: mention.payload && mention.payload.url,
          replies,
        });
        continue;
      }

      const code = extractCode(message.text);
      if (code) {
        logger.info({ igsid }, 'instagram: código de vínculo recebido');
        await handleLinkMessage({ igsid: String(igsid), code, replies });
      }
      // Qualquer outra mensagem do Direct: ignorada e não logada.
    }

    if (replies.length && igAccountId) {
      sendReplies(String(igAccountId), replies).catch(() => {});
    }
  }
}

module.exports = {
  getPublicInfo,
  createLinkCode,
  getStatus,
  unlink,
  handleWebhook,
  extractCode,
  generateCode,
  isActiveFor,
  messages,
};
