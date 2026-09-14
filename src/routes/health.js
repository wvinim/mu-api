const { Router } = require('express');
const { getPool } = require('../db/pool');

const router = Router();

// Liveness simples, sem dependências — usado por probes de infra (ex: IIS ARR).
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness — confirma que a API consegue falar com o SQL Server.
router.get('/health/db', async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.request().query('SELECT 1 AS ok');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
