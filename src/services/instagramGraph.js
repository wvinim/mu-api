const env = require('../config/env');

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

function baseUrl() {
  return `https://${env.instagram.graphHost}/${env.instagram.graphVersion}`;
}

/** Perfil de quem mandou mensagem/menção. Exige consentimento (Direct). */
async function fetchProfile(igsid) {
  const url = new URL(`${baseUrl()}/${encodeURIComponent(igsid)}`);
  url.searchParams.set('fields', 'username,follower_count');
  url.searchParams.set('access_token', env.instagram.accessToken);
  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body) {
    throw new GraphError(`Graph profile HTTP ${resp.status}`, resp.status, body && body.error);
  }
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
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new GraphError(`Graph send HTTP ${resp.status}`, resp.status, body && body.error);
  }
}

module.exports = { fetchProfile, sendText, GraphError };
