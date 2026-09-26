const request = require('supertest');

// Carrega pool.js com um mssql falso cujo connect() falha `failures` vezes.
function loadPool(failures) {
  let pool;
  const connect = jest.fn();
  jest.isolateModules(() => {
    const realSql = jest.requireActual('mssql');
    let calls = 0;
    connect.mockImplementation(async function connectImpl() {
      calls += 1;
      if (calls <= failures) throw new realSql.ConnectionError('Failed to connect', 'ESOCKET');
      return { on: jest.fn(), close: jest.fn() };
    });
    jest.doMock('mssql', () => ({ ...realSql, ConnectionPool: jest.fn(() => ({ connect })) }));
    jest.doMock('../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
    pool = require('../src/db/pool');
  });
  return { pool, connect };
}

describe('db/pool — banco indisponível', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
  });

  test('getPool() antes de conectar lança 503 DB_UNAVAILABLE', () => {
    const { pool } = loadPool(0);
    expect(() => pool.getPool()).toThrow(expect.objectContaining({ statusCode: 503, code: 'DB_UNAVAILABLE' }));
  });

  test('connectWithRetry tenta de novo com backoff exponencial até conectar', async () => {
    jest.useFakeTimers();
    const { pool, connect } = loadPool(3);
    const done = pool.connectWithRetry({ initialDelayMs: 1000, maxDelayMs: 3000 });

    await jest.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000); // 1ª espera: 1s
    expect(connect).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1999); // 2ª espera: 2s
    expect(connect).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(3000); // 3ª espera: limitada a 3s
    expect(connect).toHaveBeenCalledTimes(4);

    await expect(done).resolves.toBeTruthy();
    expect(() => pool.getPool()).not.toThrow();
  });

  test('closeDB interrompe as tentativas', async () => {
    jest.useFakeTimers();
    const { pool, connect } = loadPool(Infinity);
    const done = pool.connectWithRetry({ initialDelayMs: 1000 });
    await jest.advanceTimersByTimeAsync(0);
    await pool.closeDB();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBeNull();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('errorHandler — ConnectionError do mssql', () => {
  test('responde 503 DB_UNAVAILABLE em vez de 500', async () => {
    const express = require('express');
    const sql = require('mssql');
    const errorHandler = require('../src/middlewares/errorHandler');
    const app = express();
    app.get('/x', (req, res, next) => next(new sql.ConnectionError('socket hang up', 'ESOCKET')));
    app.use(errorHandler);

    const res = await request(app).get('/x');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
  });
});
