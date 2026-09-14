const { getPool, sql } = require('./pool');

/**
 * Acesso à tabela Character (mesma usada pelo gameserver). Só leitura
 * nesta seção — nenhuma escrita aqui. Campos binários (Inventory,
 * MagicList, Quest) nunca são expostos por esta rota; eles têm formato
 * próprio documentado em docs/INVENTORY_BYTE_FORMAT.md e só serão
 * tocados na Seção 5 (Loja).
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

// Versão pública (perfil por nome / ranking): nunca inclui Money, posição
// no mapa (MapNumber/MapPosX/MapPosY/MapDir) nem AccountID — evita expor
// localização em tempo real de outros jogadores e ligar character a
// username de conta.
const PUBLIC_CHARACTER_COLUMNS = `
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
  PkCount      AS pkCount,
  PkLevel      AS pkLevel,
  Leadership   AS leadership,
  MDate        AS createdAt,
  LDate        AS lastPlayedAt
`;

async function findPublicByName(name) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('name', sql.VarChar(10), name)
    .query(`SELECT ${PUBLIC_CHARACTER_COLUMNS} FROM Character WHERE Name = @name`);
  return result.recordset[0] || null;
}

/**
 * Ranking paginado. Usa ROW_NUMBER() em vez de OFFSET/FETCH — ver
 * docs/DB_NOTES.md (banco em compatibility level anterior ao SQL 2012).
 */
async function findRanking({ page = 1, limit = 20, classCode, search } = {}) {
  const pool = getPool();
  const firstRow = (page - 1) * limit + 1;
  const lastRow = page * limit;

  const request = pool
    .request()
    .input('firstRow', sql.Int, firstRow)
    .input('lastRow', sql.Int, lastRow);

  const filters = [];
  if (classCode !== undefined) {
    request.input('classCode', sql.TinyInt, classCode);
    filters.push('Class = @classCode');
  }
  if (search) {
    request.input('search', sql.VarChar(10), `%${search}%`);
    filters.push('Name LIKE @search');
  }
  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await request.query(`
    WITH Ranked AS (
      SELECT
        ${PUBLIC_CHARACTER_COLUMNS},
        ROW_NUMBER() OVER (ORDER BY Resets DESC, cLevel DESC) AS rank
      FROM Character
      ${whereClause}
    )
    SELECT * FROM Ranked WHERE rank BETWEEN @firstRow AND @lastRow ORDER BY rank;

    SELECT COUNT(*) AS total FROM Character ${whereClause};
  `);

  return {
    items: result.recordsets[0],
    total: result.recordsets[1][0].total,
  };
}

/** Confirma que o personagem pertence à conta antes de qualquer escrita (loja). */
async function findOwnedCharacter(accountId, name) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('accountId', sql.VarChar(10), accountId)
    .input('name', sql.VarChar(10), name)
    .query('SELECT Name FROM Character WHERE AccountID = @accountId AND Name = @name');
  return result.recordset[0] || null;
}

async function getInventoryBuffer(name) {
  const pool = getPool();
  const result = await pool
    .request()
    .input('name', sql.VarChar(10), name)
    .query('SELECT Inventory FROM Character WHERE Name = @name');
  return result.recordset[0]?.Inventory || null;
}

async function updateInventory(name, inventoryBuffer) {
  const pool = getPool();
  await pool
    .request()
    .input('name', sql.VarChar(10), name)
    .input('inventory', sql.VarBinary(1728), inventoryBuffer)
    .query('UPDATE Character SET Inventory = @inventory WHERE Name = @name');
}

module.exports = {
  findByAccountId,
  findPublicByName,
  findRanking,
  findOwnedCharacter,
  getInventoryBuffer,
  updateInventory,
};
