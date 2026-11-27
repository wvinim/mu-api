const charactersRepository = require('../db/charactersRepository');
const TtlCache = require('../utils/ttlCache');
const env = require('../config/env');

const rankingCache = new TtlCache(env.rankingCacheTtlSeconds);
// Período anterior (ontem, semana/mês passado) não muda mais: cache longo.
const previousRankingCache = new TtlCache(env.rankingPreviousCacheTtlSeconds);

// Dia de hoje em Brasília (só para a chave do cache): na virada do dia a
// chave muda e o ranking de "hoje"/"ontem" não fica preso no dia anterior.
// As datas do período em si são calculadas no SQL.
function brasiliaToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

async function getRanking(req, res, next) {
  try {
    const { period, previous, classCode } = req.query;
    const limit = Math.min(req.query.limit, charactersRepository.RANKING_TOP);
    // classCode filtra pela raça inteira (1ª/2ª/3ª classe): a base da raça
    // é múltiplo de 16 e as evoluções somam +1/+2 (ex: 0/1/3 = DW/SM/GrM).
    // Normalizar aqui faz ?classCode=0 e ?classCode=3 dividirem a mesma
    // entrada de cache.
    const raceCode = classCode === undefined ? undefined : classCode & 0xf0;
    const cacheKey = JSON.stringify({ day: brasiliaToday(), period, previous, limit, raceCode });
    const cache = previous ? previousRankingCache : rankingCache;

    let result = cache.get(cacheKey);
    if (!result) {
      result = await charactersRepository.findRanking({ period, previous, limit, raceCode });
      cache.set(cacheKey, result);
    }

    // page/limit/total mantidos para o front antigo (sempre 1 página).
    res.json({
      period,
      previous,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      page: 1,
      limit,
      total: result.items.length,
      items: result.items,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getRanking };
