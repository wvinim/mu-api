const serverStatusRepository = require('../db/serverStatusRepository');
const TtlCache = require('../utils/ttlCache');
const env = require('../config/env');

const statusCache = new TtlCache(env.server.statusCacheTtlSeconds);
const STATUS_CACHE_KEY = 'status';

async function getStatus(req, res, next) {
  try {
    let status = statusCache.get(STATUS_CACHE_KEY);
    if (!status) {
      const playersOnline = await serverStatusRepository.getOnlineCount();
      status = { status: 'online', playersOnline };
      statusCache.set(STATUS_CACHE_KEY, status);
    }
    res.json(status);
  } catch (err) {
    next(err);
  }
}

// Metadados estáticos, vindos do .env — não há tabela no banco com essa
// informação. Ver docs/SECTION_8_SERVER.md.
function getInfo(req, res) {
  res.json({
    name: env.server.name,
    season: env.server.season,
    expRate: env.server.expRate,
    dropRate: env.server.dropRate,
    maxResets: env.server.maxResets,
    websiteUrl: env.appUrl,
  });
}

module.exports = { getStatus, getInfo };
