// Testes de texto de SQL pro charactersRepository.findRanking — o
// characters.test.js mocka o repositório inteiro e nunca vê o WHERE real.

jest.mock('../src/db/pool', () => ({
  sql: { Int: 'Int', TinyInt: 'TinyInt', VarChar: jest.fn(() => 'VarChar') },
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const charactersRepository = require('../src/db/charactersRepository');

function mockPool() {
  const inputs = {};
  const queries = [];
  const req = {
    input: (name, type, value) => {
      inputs[name] = value;
      return req;
    },
    query: jest.fn((text) => {
      queries.push(text);
      return Promise.resolve({ recordsets: [[], [{ total: 0 }]] });
    }),
  };
  getPool.mockReturnValue({ request: () => req });
  return { inputs, queries };
}

describe('charactersRepository.findRanking', () => {
  it('filtra a raça inteira por faixa, no ranking e no total', async () => {
    const { inputs, queries } = mockPool();

    await charactersRepository.findRanking({ page: 1, limit: 20, raceCode: 0 });

    expect(inputs).toMatchObject({ raceMin: 0, raceMax: 16 });
    const sqlText = queries[0];
    expect(sqlText).not.toMatch(/Class = @/);
    // Aparece duas vezes: no CTE do ranking e no COUNT do total.
    expect(sqlText.match(/WHERE Class >= @raceMin AND Class < @raceMax/g)).toHaveLength(2);
    expect(sqlText).toMatch(/ORDER BY Resets DESC, cLevel DESC/);
  });

  it('sem filtro não tem WHERE', async () => {
    const { inputs, queries } = mockPool();

    await charactersRepository.findRanking({ page: 1, limit: 20 });

    expect(inputs.raceMin).toBeUndefined();
    expect(queries[0]).not.toMatch(/WHERE Class/);
  });
});

describe('charactersRepository.findPublicByName', () => {
  it('seleciona só nome e resets (sem build, nível, experiência ou PvP)', async () => {
    const queries = [];
    const req = {
      input: () => req,
      query: jest.fn((text) => {
        queries.push(text);
        return Promise.resolve({ recordset: [{ name: 'Hero1', resets: 10 }] });
      }),
    };
    getPool.mockReturnValue({ request: () => req });

    const result = await charactersRepository.findPublicByName('Hero1');

    expect(result).toEqual({ name: 'Hero1', resets: 10 });
    expect(queries[0]).toMatch(/Name\s+AS name/);
    expect(queries[0]).toMatch(/Resets\s+AS resets/);
    expect(queries[0]).not.toMatch(/Strength|cLevel|Experience|PkCount|Class\b|Money|MapPos/);
  });
});

describe('charactersRepository.findRanking — colunas', () => {
  it('expõe só nome, nível, classe e resets (sem build, experiência ou PvP)', async () => {
    const { queries } = mockPool();

    await charactersRepository.findRanking({ page: 1, limit: 20 });

    const select = queries[0].split('ROW_NUMBER()')[0];
    expect(select).toMatch(/Name\s+AS name/);
    expect(select).toMatch(/cLevel\s+AS level/);
    expect(select).toMatch(/Class\s+AS classCode/);
    expect(select).toMatch(/Resets\s+AS resets/);
    expect(select).not.toMatch(/Strength|Dexterity|Vitality|Energy|Leadership|Experience|PkCount|PkLevel|Money|MapPos/);
  });
});
