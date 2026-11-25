const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * Chamadas à Graph API da Meta (Unified Login: graph.facebook.com com o token
 * de usuário do sistema). Nunca logar a URL: ela leva o access_token.
 */

class GraphError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GraphError';
    this.status = status;
    this.body = body;
  }
}

// Uso do limite de chamadas que a Meta informa em toda resposta, em % (0-100).
const USAGE_WARN_PERCENT = 75;
// Códigos de erro da Graph API para limite de chamadas atingido.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);

function parseJsonHeader(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Maior percentual de uso informado nos headers X-App-Usage (limite do app)
 * e X-Business-Use-Case-Usage (limite por conta, usado pelo Instagram).
 */
function readUsage(headers) {
  const entries = [];
  const app = parseJsonHeader(headers.get('x-app-usage'));
  if (app && typeof app === 'object') entries.push({ source: 'app', ...app });
  const buc = parseJsonHeader(headers.get('x-business-use-case-usage'));
  if (buc && typeof buc === 'object') {
    for (const list of Object.values(buc)) {
      if (Array.isArray(list)) list.forEach((item) => entries.push({ source: 'business', ...item }));
    }
  }
  let max = 0;
  for (const e of entries) {
    for (const key of ['call_count', 'total_cputime', 'total_time']) {
      if (typeof e[key] === 'number' && e[key] > max) max = e[key];
    }
  }
  return { max, entries };
}

function checkUsage(resp, call) {
  const { max, entries } = readUsage(resp.headers);
  if (max >= USAGE_WARN_PERCENT) {
    logger.warn({ call, usagePercent: max, usage: entries }, 'instagram: limite de chamadas da Graph API perto do fim');
  }
}

function graphError(call, status, error) {
  const err = new GraphError(`Graph ${call} HTTP ${status}`, status, error);
  if (error && RATE_LIMIT_CODES.has(error.code)) {
    err.rateLimited = true;
    logger.error({ call, code: error.code }, 'instagram: limite de chamadas da Graph API atingido');
  }
  return err;
}

function baseUrl() {
  return `https://${env.instagram.graphHost}/${env.instagram.graphVersion}`;
}

/** Perfil de quem mandou mensagem/menção. Exige consentimento (Direct). */
async function fetchProfile(igsid) {
  const url = new URL(`${baseUrl()}/${encodeURIComponent(igsid)}`);
  url.searchParams.set('fields', 'username,follower_count');
  url.searchParams.set('access_token', env.instagram.accessToken);
  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
  checkUsage(resp, 'profile');
  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body) throw graphError('profile', resp.status, body && body.error);
  return {
    username: typeof body.username === 'string' ? body.username : null,
    followerCount: Number.isInteger(body.follower_count) ? body.follower_count : null,
  };
}

/**
 * Responde no Direct. Só vale até 24h depois da última mensagem da pessoa
 * (a menção em story conta como mensagem).
 */
async function sendText(igAccountId, recipientIgsid, text) {
  const url = `${baseUrl()}/${encodeURIComponent(igAccountId)}/messages`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.instagram.accessToken}` },
    body: JSON.stringify({ recipient: { id: recipientIgsid }, message: { text } }),
    signal: AbortSignal.timeout(5000),
  });
  checkUsage(resp, 'send');
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw graphError('send', resp.status, body && body.error);
  }
}

module.exports = { fetchProfile, sendText, GraphError, readUsage };
