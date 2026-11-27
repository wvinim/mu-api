const { getPool, sql } = require('./pool');

/**
 * Acesso à tabela Character (mesma usada pelo gameserver). Só leitura —
 * a loja (Seção 5) resgata itens no baú da conta (warehouse), não mais
 * aqui (ver src/db/warehouseRepository.js). Campos binários (Inventory,
 * MagicList, Quest) nunca são expostos por esta rota; Inventory tem
 * formato próprio documentado em docs/INVENTORY_BYTE_FORMAT.md.
 *
 * Nota: [Class] é um tinyint bruto — a decodificação exata de classe +
 * evolução (formato de bits) não foi validada ainda nesta sessão, então
 * devolvemos o código cru (classCode) em vez de adivinhar um nome.
 */
const CHARACTER_COLUMNS = `
  Name         AS name,
  cLevel       AS level,
  Class        AS classCode,
  Experience   AS experience,
  Resets       AS resets,
  ResetsDay    AS resetsDay,
  ResetsWeek   AS resetsWeek,
  ResetsMonth  AS resetsMonth,
  Strength     AS strength,
  Dexterity    AS dexterity,
  Vitality     AS vitality,
  Energy       AS energy,
  Life         AS life,
  MaxLife      AS maxLife,
  Mana         AS mana,
  MaxMana      AS maxMana,
  Money        AS money,
  MapNumber    AS mapNumber,
  MapPosX      AS mapPosX,
  MapPosY      AS mapPosY,
  PkCount      AS pkCount,
  PkLevel      AS pkLevel,
  Leadership   AS leadership,
  MDate        AS createdAt,
  LDate        AS lastPlayedAt
`;

async function findByAccountId(accountId) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .query(`SELECT ${CHARACTER_COLUMNS} FROM Character WHERE AccountID = @accountId ORDER BY Name`);
  return result.recordset;
}

// Ranking público: só o que a tabela do site mostra. Build (atributos),
// experiência, PvP e datas não são expostos (decisão do usuário,
// 2026-10-05). Nunca inclui Money, posição no mapa nem AccountID.
//
// Desde 2026-11-26 (limite de 200 resets + Time Collector) o ranking é por
// período e sempre só o top 10 (RANKING_TOP):
//   - total: Character.ResetsMonth = total histórico desde o wipe (nunca
//     zerada; a troca no Time Collector soma 1). Empate: último reset mais
//     antigo vence, depois nível.
//   - day / week / month: SUM(Qtd) da dbo.ResetDiario (1 linha por personagem
//     por dia, gravada pelo trigger TR_Character_ResetDiario — ver
//     migrations/0019_ranking_periodo.sql). Semana = segunda a domingo.
//
// As datas do período são calculadas NO SQL com GETDATE() (relógio da VPS =
// horário de Brasília, igual ao trigger). Não calcular em JS: o driver
// trabalha em UTC e a virada do dia sairia 3h errada.
//
// WITH (NOLOCK): ranking tolera leitura suja e nunca espera nem segura lock
// das escritas do gameserver/DataServer em Character.
const RANKING_TOP = 10;
const RANKING_PERIODS = ['total', 'month', 'week', 'day'];

// Início/fim (inclusivos) de cada período; @prev = 0 atual, 1 anterior.
// (Sem variável @Prev: se a collation do servidor ignora maiúsculas, @Prev e
// o parâmetro @prev seriam a mesma variável — "already declared".)
// '19000101' foi segunda-feira: DATEDIFF(day, '19000101', x) % 7 = dias desde
// a última segunda, sem depender de SET DATEFIRST.
const PERIOD_BOUNDS = {
  day: `
    SET @Ini = DATEADD(day, -@prev, @Hoje);
    SET @Fim = @Ini;`,
  week: `
    SET @Ini = DATEADD(day, -(DATEDIFF(day, '19000101', @Hoje) % 7) - 7 * @prev, @Hoje);
    SET @Fim = DATEADD(day, 6, @Ini);`,
  month: `
    SET @Ini = DATEADD(month, DATEDIFF(month, '19000101', @Hoje) - @prev, '19000101');
    SET @Fim = DATEADD(day, -1, DATEADD(month, 1, @Ini));`,
};

function rankingFilters(request, raceCode, alias) {
  // HideFromRanking (migration 0013): personagens marcados ficam fora.
  const filters = [`${alias}.HideFromRanking = 0`];
  if (raceCode !== undefined) {
    // `raceCode` é a base da raça (múltiplo de 16); a faixa
    // [raceCode, raceCode + 16) pega 1ª, 2ª e 3ª classe juntas.
    // Int, não TinyInt: raceCode + 16 pode passar de 255.
    request.input('raceMin', sql.Int, raceCode).input('raceMax', sql.Int, raceCode + 16);
    filters.push(`${alias}.Class >= @raceMin AND ${alias}.Class < @raceMax`);
  }
  return `WHERE ${filters.join(' AND ')}`;
}

/**
 * Top 10 de um período. Usa ROW_NUMBER() — ver docs/DB_NOTES.md (banco em
 * compatibility level anterior ao SQL 2012, sem OFFSET/FETCH).
 *
 * Retorna { items: [{ rank, name, level, classCode, resets }], periodStart,
 * periodEnd } — `resets` = resets no período; datas 'YYYY-MM-DD' (dia em
 * Brasília) ou null no total.
 */
async function findRanking({ period = 'total', previous = false, raceCode, limit = RANKING_TOP } = {}) {
  if (!RANKING_PERIODS.includes(period)) throw new Error(`period inválido: ${period}`);
  const top = Math.min(Math.max(1, limit), RANKING_TOP);

  const pool = getPool();
  const request = pool.request().input('top', sql.Int, top);

  if (period === 'total') {
    const whereClause = rankingFilters(request, raceCode, 'c');
    // Desempate (decisão do usuário, 2026-11-27): com os mesmos resets, vence
    // quem fez o último reset primeiro (MAX(UltimoReset) da ResetDiario).
    // NULL vem antes no ASC: sem linha na ResetDiario = último reset mais
    // antigo que a limpeza (mês-2), então chegou primeiro mesmo. Com 0
    // resets todos são NULL e o nível decide; depois o nome (ordem estável).
    const result = await request.query(`
      WITH Ultimo AS (
        SELECT r.Name, MAX(r.UltimoReset) AS Ultimo
        FROM dbo.ResetDiario r WITH (NOLOCK)
        GROUP BY r.Name
      )
      SELECT TOP (@top)
        c.Name        AS name,
        c.cLevel      AS level,
        c.Class       AS classCode,
        c.ResetsMonth AS resets,
        ROW_NUMBER() OVER (ORDER BY c.ResetsMonth DESC, u.Ultimo ASC, c.cLevel DESC, c.Name) AS rank
      FROM Character c WITH (NOLOCK)
      LEFT JOIN Ultimo u ON u.Name = c.Name
      ${whereClause}
      ORDER BY c.ResetsMonth DESC, u.Ultimo ASC, c.cLevel DESC, c.Name;
    `);
    return { items: result.recordset, periodStart: null, periodEnd: null };
  }

  request.input('prev', sql.Int, previous ? 1 : 0);
  const whereClause = rankingFilters(request, raceCode, 'c');
  // Desempate: quem chegou primeiro ao número (último reset mais cedo).
  const result = await request.query(`
    DECLARE @Hoje date, @Ini date, @Fim date;
    SET @Hoje = CAST(GETDATE() AS date);
    ${PERIOD_BOUNDS[period]}

    WITH Soma AS (
      SELECT r.Name, SUM(r.Qtd) AS Qtd, MAX(r.UltimoReset) AS Ultimo
      FROM dbo.ResetDiario r WITH (NOLOCK)
      WHERE r.Dia BETWEEN @Ini AND @Fim
      GROUP BY r.Name
    ),
    Ranked AS (
      SELECT
        c.Name    AS name,
        c.cLevel  AS level,
        c.Class   AS classCode,
        s.Qtd     AS resets,
        ROW_NUMBER() OVER (ORDER BY s.Qtd DESC, s.Ultimo ASC, c.Name) AS rank
      FROM Soma s
      JOIN Character c WITH (NOLOCK) ON c.Name = s.Name
      ${whereClause}
    )
    SELECT * FROM Ranked WHERE rank <= @top ORDER BY rank;

    SELECT CONVERT(char(10), @Ini, 120) AS periodStart, CONVERT(char(10), @Fim, 120) AS periodEnd;
  `);

  return {
    items: result.recordsets[0],
    periodStart: result.recordsets[1][0].periodStart,
    periodEnd: result.recordsets[1][0].periodEnd,
  };
}

module.exports = {
  RANKING_TOP,
  RANKING_PERIODS,
  findByAccountId,
  findRanking,
};
