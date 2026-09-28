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
    const { page, limit, classCode } = req.query;
    // classCode filtra pela raça inteira (1ª/2ª/3ª classe): a base da raça
    // é múltiplo de 16 e as evoluções somam +1/+2 (ex: 0/1/3 = DW/SM/GrM).
    // Normalizar aqui faz ?classCode=0 e ?classCode=3 dividirem a mesma
    // entrada de cache.
    const raceCode = classCode === undefined ? undefined : classCode & 0xf0;
    const cacheKey = JSON.stringify({ page, limit, raceCode });

    let result = rankingCache.get(cacheKey);
    if (!result) {
      result = await charactersRepository.findRanking({ page, limit, raceCode });
      rankingCache.set(cacheKey, result);
    }

    res.json({ page, limit, total: result.total, items: result.items });
  } catch (err) {
    next(err);
  }
}

module.exports = { getByName, getRanking };
