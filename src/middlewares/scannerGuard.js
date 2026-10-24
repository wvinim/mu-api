const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * Bloqueio de scanners/bots por IP, em memória (instância única — mesma
 * decisão do rate limit). Dois gatilhos:
 *
 *  - Rota inexistente (notFound) = 1 strike. `maxStrikes` strikes dentro de
 *    `windowMinutes` bloqueia o IP. Só o notFound conta: 404 legítimo de
 *    controller (ex: personagem inexistente) não vira strike.
 *  - Caminho de exploit óbvio (PROBE_PATH) bloqueia na hora — nenhum
 *    usuário real pede /.env ou /wp-login.php a uma API JSON.
 *
 * IP bloqueado recebe 403 curto, antes do logger (não gera linha de log);
 * só o momento do bloqueio é logado. Loopback nunca é bloqueado: se o
 * TRUST_PROXY estiver errado, req.ip é o do nginx e um bloqueio derrubaria
 * todo mundo.
 */
const PROBE_PATH = new RegExp(
  [
    '/\\.(env|git|svn|hg|aws|ssh|DS_Store|htaccess|htpasswd|vscode|idea)',
    '\\.(php\\d?|asp|aspx|jsp|jspa|cgi|pl|sql|bak|old|swp|ini|conf|cfg|log|tar|gz|zip|rar|7z)(\\?|/|$)',
    '/(wp-|wordpress|xmlrpc|phpmyadmin|pma|myadmin|cgi-bin|vendor/phpunit|actuator|boaform|hnap1|solr|druid|telescope|_profiler|_ignition|owa/|ecp/|autodiscover|remote/login|geoserver|containers/json|server-status|console/)',
  ].join('|'),
  'i',
);

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_TRACKED_IPS = 50000;

function createScannerGuard({
  enabled = true,
  maxStrikes,
  windowMinutes,
  banMinutes,
  allowlist = [],
  now = Date.now,
  log = logger,
}) {
  const windowMs = windowMinutes * 60 * 1000;
  const banMs = banMinutes * 60 * 1000;
  const allowed = new Set(allowlist);
  const strikes = new Map(); // ip -> { count, resetAt }
  const bans = new Map(); // ip -> expiresAt

  function isExempt(ip) {
    return !enabled || !ip || LOOPBACK.has(ip) || allowed.has(ip);
  }

  function isBanned(ip) {
    const expiresAt = bans.get(ip);
    if (expiresAt === undefined) return false;
    if (now() >= expiresAt) {
      bans.delete(ip);
      return false;
    }
    return true;
  }

  function ban(ip, reason, url) {
    bans.set(ip, now() + banMs);
    strikes.delete(ip);
    log.warn({ ip, reason, url, banMinutes }, 'scanner guard: IP bloqueado');
  }

  function addStrike(req) {
    const ip = req.ip;
    if (isExempt(ip) || isBanned(ip)) return;
    const t = now();
    let entry = strikes.get(ip);
    if (!entry || t >= entry.resetAt) {
      // Sem limite de tamanho, um scanner com IPs rotativos encheria a memória.
      if (!entry && strikes.size >= MAX_TRACKED_IPS) strikes.clear();
      entry = { count: 0, resetAt: t + windowMs };
      strikes.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count >= maxStrikes) ban(ip, 'too_many_not_found', req.originalUrl);
  }

  // Vai antes do logger: request de IP bloqueado não gera linha de log.
  function middleware(req, res, next) {
    const ip = req.ip;
    if (isExempt(ip)) return next();
    if (!isBanned(ip)) {
      if (!PROBE_PATH.test(req.path)) return next();
      ban(ip, 'probe_path', req.originalUrl);
    }
    res.set('Connection', 'close');
    return res.status(403).json({ error: { code: 'IP_BLOCKED', message: 'Acesso bloqueado temporariamente.' } });
  }

  function sweep() {
    const t = now();
    for (const [ip, expiresAt] of bans) if (t >= expiresAt) bans.delete(ip);
    for (const [ip, entry] of strikes) if (t >= entry.resetAt) strikes.delete(ip);
  }

  return { middleware, addStrike, sweep, isBanned };
}

const scannerGuard = createScannerGuard(env.scannerGuard);
setInterval(scannerGuard.sweep, 5 * 60 * 1000).unref();

module.exports = { scannerGuard, createScannerGuard, PROBE_PATH };
