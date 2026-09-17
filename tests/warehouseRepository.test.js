// Testes de texto de SQL pro warehouseRepository (ver docs/WAREHOUSE_BYTE_FORMAT.md)
// — os testes de controller (shop.test.js) mockam esse repositório
// inteiro e nunca executam o SQL de verdade, então erros de
// nome de coluna/tabela, a ausência do UPDLOCK/HOLDLOCK (crítico aqui,
// já que `warehouse` não tem PK/índice único — ver dumpWarehouse.js
// --schema), ou o bug de duplicar linha (ver abaixo) só apareceriam
// contra o banco real sem isso.

jest.mock('../src/db/pool', () => ({
  sql: {
    VarChar: jest.fn(() => 'type'),
    Int: jest.fn(() => 'type'),
    VarBinary: jest.fn(() => 'type'),
    Transaction: jest.fn(),
    Request: jest.fn(),
  },
  getPool: jest.fn(),
}));

const { getPool, sql } = require('../src/db/pool');
const warehouseRepository = require('../src/db/warehouseRepository');

function mockTransaction(existingRows) {
  const begin = jest.fn().mockResolvedValue();
  const commit = jest.fn().mockResolvedValue();
  const rollback = jest.fn().mockResolvedValue();
  sql.Transaction.mockImplementation(() => ({ begin, commit, rollback }));

  const calls = [];
  sql.Request.mockImplementation(() => {
    const req = {
      input: () => req,
      query: jest.fn((text) => {
        calls.push(text);
        if (/^\s*SELECT TOP 1 Items, VaultID/.test(text)) {
          return Promise.resolve({ recordset: existingRows });
        }
        return Promise.resolve({});
      }),
    };
    return req;
  });

  return { calls, begin, commit, rollback };
}

describe('warehouseRepository.ensureRowAndGetItems', () => {
  it('checa a linha existente só por AccountID, SEM filtrar por VaultID — bug corrigido (ver abaixo)', async () => {
    const buf = Buffer.alloc(1920, 0xff);
    const { calls, commit, rollback } = mockTransaction([{ Items: buf, VaultID: 0 }]);

    const result = await warehouseRepository.ensureRowAndGetItems('player1');

    expect(calls[0]).toMatch(/WITH \(UPDLOCK, HOLDLOCK\)/);
    expect(calls[0]).toMatch(/WHERE AccountID = @accountId\s*$/); // WHERE só por AccountID — nunca filtra a checagem por VaultID
    expect(calls[0]).not.toMatch(/WHERE.*VaultID/); // VaultID pode estar no SELECT, não no WHERE
    expect(result).toEqual({ items: buf, vaultId: 0 });
    expect(commit).toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
    // Linha já existia — não deve tentar inserir.
    expect(calls.some((c) => /INSERT INTO warehouse/.test(c))).toBe(false);
  });

  it('BUG CORRIGIDO: não insere uma linha duplicada quando a conta já tem uma linha com VaultID != 0', async () => {
    const buf = Buffer.alloc(1920, 0xff);
    const { calls, commit } = mockTransaction([{ Items: buf, VaultID: 7 }]);

    const result = await warehouseRepository.ensureRowAndGetItems('player1');

    // Devolve o VaultID REAL da linha, não presume 0.
    expect(result).toEqual({ items: buf, vaultId: 7 });
    expect(calls.some((c) => /INSERT INTO warehouse/.test(c))).toBe(false);
    expect(commit).toHaveBeenCalled();
  });

  it('cria a linha com os valores padrão confirmados (VaultID=0) quando a conta não tem NENHUMA linha', async () => {
    const { calls, commit } = mockTransaction([]);

    const result = await warehouseRepository.ensureRowAndGetItems('newplayer');

    const insertText = calls.find((c) => /INSERT INTO warehouse/.test(c));
    expect(insertText).toBeDefined();
    expect(insertText).toMatch(/\(AccountID, Items, Money, EndUseDate, DbVersion, pw, VaultID, Number\)/);
    expect(insertText).toMatch(/VALUES \(@accountId, @items, 0, NULL, 3, 0, @vaultId, NULL\)/);
    expect(result.items.length).toBe(1920);
    expect(result.vaultId).toBe(0);
    expect(commit).toHaveBeenCalled();
  });

  it('dá rollback se qualquer query da transação falhar', async () => {
    const { rollback } = mockTransaction([]);
    sql.Request.mockImplementation(() => ({
      input() {
        return this;
      },
      query: jest.fn().mockRejectedValue(new Error('falha de banco')),
    }));

    await expect(warehouseRepository.ensureRowAndGetItems('player1')).rejects.toThrow('falha de banco');
    expect(rollback).toHaveBeenCalled();
  });
});

describe('warehouseRepository.updateItems', () => {
  it('grava em warehouse filtrando por AccountID e pelo VaultID passado (não um valor fixo)', async () => {
    const inputs = [];
    const request = {
      input: jest.fn(function input(name, type, value) {
        inputs.push([name, value]);
        return request;
      }),
      query: jest.fn().mockResolvedValue({}),
    };
    getPool.mockReturnValue({ request: () => request });

    await warehouseRepository.updateItems('player1', 7, Buffer.alloc(1920, 0x00));

    const sqlText = request.query.mock.calls[0][0];
    expect(sqlText).toMatch(/UPDATE warehouse SET Items = @items/);
    expect(sqlText).toMatch(/WHERE AccountID = @accountId AND VaultID = @vaultId/);
    expect(inputs).toContainEqual(['vaultId', 7]);
  });
});
