const AppError = require('../utils/AppError');
const charactersRepository = require('../db/charactersRepository');
const TtlCache = require('../utils/ttlCache');
const env = require('../config/env');

const rankingCache = new TtlCache(env.rankingCacheTtlSeconds);

async function getByName(req, res, next) {
  try {
    const { name } = req.params;
    const character = await charactersRepository.findPublicByName(name);
    if (!character) {
      throw new AppError(404, 'NOT_FOUND', 'Personagem não encontrado.');
    }
    res.json(character);
  } catch (err) {
    next(err);
  }
}

async function getRanking(req, res, next) {
  try {
    const { page, limit, classCode, search } = req.query;
    const cacheKey = JSON.stringify({ page, limit, classCode, search });

    let result = rankingCache.get(cacheKey);
    if (!result) {
      result = await charactersRepository.findRanking({ page, limit, classCode, search });
      rankingCache.set(cacheKey, result);
    }

    res.json({ page, limit, total: result.total, items: result.items });
  } catch (err) {
    next(err);
  }
}

module.exports = { getByName, getRanking };
