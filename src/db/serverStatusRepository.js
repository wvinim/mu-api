const { getPool } = require('./pool');

async function getOnlineCount() {
  const pool = getPool();
  const result = await pool.request().query(`
    SELECT COUNT(*) AS onlineCount
    FROM MEMB_STAT
    WHERE ConnectStat = 1
  `);
  return result.recordset[0].onlineCount;
}

module.exports = { getOnlineCount };
