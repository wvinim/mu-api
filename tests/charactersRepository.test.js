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
