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
      return Promise.resolve({
        recordset: [],
        recordsets: [[], [{ periodStart: '2026-11-23', periodEnd: '2026-11-29' }]],
      });
    }),
  };
  getPool.mockReturnValue({ request: () => req });
  return { inputs, queries };
}

describe('charactersRepository.findRanking — total', () => {
  it('top N pelo total histórico (ResetsMonth), desempate pelo último reset mais antigo', async () => {
    const { inputs, queries } = mockPool();

    await charactersRepository.findRanking({ period: 'total', limit: 10 });

    expect(inputs.top).toBe(10);
    expect(queries[0]).toMatch(/SELECT TOP \(@top\)/);
    expect(queries[0]).toMatch(/ORDER BY c\.ResetsMonth DESC, u\.Ultimo ASC, c\.cLevel DESC, c\.Name;/);
    expect(queries[0]).toMatch(/Character c WITH \(NOLOCK\)/);
    expect(queries[0]).toMatch(/MAX\(r\.UltimoReset\)/);
    expect(queries[0]).toMatch(/LEFT JOIN Ultimo u ON u\.Name = c\.Name/);
    expect(queries[0]).toMatch(/WHERE c\.HideFromRanking = 0\s/);
  });

  it('nunca passa de 10, mesmo pedindo mais', async () => {
    const { inputs } = mockPool();
    await charactersRepository.findRanking({ period: 'total', limit: 50 });
    expect(inputs.top).toBe(10);
  });

  it('filtra a raça inteira por faixa', async () => {
    const { inputs, queries } = mockPool();

    await charactersRepository.findRanking({ period: 'total', raceCode: 16 });

    expect(inputs).toMatchObject({ raceMin: 16, raceMax: 32 });
    expect(queries[0]).toMatch(/WHERE c\.HideFromRanking = 0 AND c\.Class >= @raceMin AND c\.Class < @raceMax/);
  });
});

describe('charactersRepository.findRanking — períodos', () => {
  it.each(['day', 'week', 'month'])('%s soma ResetDiario no intervalo, datas calculadas no SQL', async (period) => {
    const { inputs, queries } = mockPool();

    const result = await charactersRepository.findRanking({ period, previous: true });

    expect(inputs).toMatchObject({ prev: 1, top: 10 });
    const q = queries[0];
    expect(q).toMatch(/SET @Hoje = CAST\(GETDATE\(\) AS date\)/);
    expect(q).toMatch(/FROM dbo\.ResetDiario r WITH \(NOLOCK\)\s+WHERE r\.Dia BETWEEN @Ini AND @Fim/);
    expect(q).toMatch(/JOIN Character c WITH \(NOLOCK\) ON c\.Name = s\.Name/);
    expect(q).toMatch(/ORDER BY s\.Qtd DESC, s\.Ultimo ASC, c\.Name/);
    expect(q).toMatch(/WHERE c\.HideFromRanking = 0\s/);
    expect(q).not.toMatch(/OFFSET|FETCH/);
    // Sem variável @Prev (conflitaria com o parâmetro @prev em collation CI).
    expect(q).not.toMatch(/DECLARE[^;]*@Prev/i);
    expect(result).toEqual({ items: [], periodStart: '2026-11-23', periodEnd: '2026-11-29' });
  });

  it('período atual manda @prev = 0', async () => {
    const { inputs } = mockPool();
    await charactersRepository.findRanking({ period: 'week' });
    expect(inputs.prev).toBe(0);
  });

  it('semana começa na segunda sem depender de DATEFIRST', async () => {
    const { queries } = mockPool();
    await charactersRepository.findRanking({ period: 'week' });
    expect(queries[0]).toMatch(/DATEDIFF\(day, '19000101', @Hoje\) % 7/);
    expect(queries[0]).not.toMatch(/DATEPART\(weekday|DATEFIRST/i);
  });

  it('período inválido dá erro antes de ir ao banco', async () => {
    const { queries } = mockPool();
    await expect(charactersRepository.findRanking({ period: 'year' })).rejects.toThrow(/period/);
    expect(queries).toHaveLength(0);
  });
});

describe('charactersRepository.findRanking — colunas', () => {
  it.each(['total', 'week'])('%s expõe só nome, nível, classe e resets', async (period) => {
    const { queries } = mockPool();

    await charactersRepository.findRanking({ period });

    const select = queries[0].split('ROW_NUMBER()')[0];
    expect(select).toMatch(/Name\s+AS name/);
    expect(select).toMatch(/cLevel\s+AS level/);
    expect(select).toMatch(/Class\s+AS classCode/);
    expect(select).toMatch(/AS resets/);
    expect(select).not.toMatch(/Strength|Dexterity|Vitality|Energy|Leadership|Experience|PkCount|PkLevel|Money|MapPos|AccountID/);
  });
});
