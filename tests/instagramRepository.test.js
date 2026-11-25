// Texto de SQL do instagramRepository (os testes do serviço mockam o
// repositório inteiro): prêmio único por IGSID, crédito atômico, vínculo
// com trava e checagem de dono, sem sintaxe que o SQL Server 2008 recusa.

jest.mock('../src/db/pool', () => ({
  sql: {
    VarChar: jest.fn(() => 'varchar'),
    Int: jest.fn(() => 'int'),
  },
  getPool: jest.fn(),
}));

const { getPool } = require('../src/db/pool');
const repo = require('../src/db/instagramRepository');


function mockPool(...results) {
  const queries = [];
  const inputs = {};
  let call = 0;
  const makeReq = () => {
    const req = {
      input: jest.fn((name, _type, value) => {
        inputs[name] = value;
        return req;
      }),
      query: jest.fn((text) => {
        queries.push(text);
        const r = results[Math.min(call, results.length - 1)];
        call += 1;
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
      }),
    };
    return req;
  };
  getPool.mockReturnValue({ request: makeReq });
  return { queries, inputs };
}

describe('rewardMention', () => {
  it('trava o IGSID, grava o prêmio, credita Cash e marca a menção na mesma transação', async () => {
    const { queries, inputs } = mockPool({ recordset: [{ result: 'rewarded' }] });
    const out = await repo.rewardMention({
      mid: 'm1', igsid: '555', username: 'player1', igUsername: 'fulano', followerCount: 152, amount: 40,
    });
    expect(out).toBe('rewarded');
    const q = queries[0];
    expect(q).toMatch(/BEGIN TRANSACTION/);
    expect(q).toMatch(/FROM WebInstagramRewards WITH \(UPDLOCK, HOLDLOCK\) WHERE Igsid = @igsid/);
    expect(q).toMatch(/FROM WebInstagramRewards WITH \(UPDLOCK, HOLDLOCK\) WHERE Username = @username/);
    expect(q).toMatch(/'account_already_rewarded'/);
    expect(q).toMatch(/INSERT INTO WebInstagramRewards/);
    expect(q).toMatch(/SET Cash = Cash \+ @amount/);
    expect(q).toMatch(/WHERE memb___id = @username/);
    expect(q).toMatch(/@@ROWCOUNT <> 1/);
    expect(q).toMatch(/Status = 'rewarded'/);
    expect(q).toMatch(/COMMIT TRANSACTION/);
    expect(q).not.toMatch(/\bTHROW\b/);
    expect(inputs.amount).toBe(40);
  });

  it('devolve already_rewarded quando o banco recusa', async () => {
    mockPool({ recordset: [{ result: 'already_rewarded' }] });
    expect(await repo.rewardMention({ mid: 'm1', igsid: '555', username: 'p', amount: 40 })).toBe('already_rewarded');
  });
});

describe('consumeLinkCode', () => {
  it('trava código e vínculo, recusa IGSID de outra conta, marca o código usado', async () => {
    const { queries } = mockPool({ recordset: [{ result: 'linked', username: 'player1' }] });
    const out = await repo.consumeLinkCode('MUPRO-ABC234', '555', 'fulano');
    expect(out).toEqual({ result: 'linked', username: 'player1' });
    const q = queries[0];
    expect(q).toMatch(/FROM WebInstagramLinkCodes WITH \(UPDLOCK, HOLDLOCK\)/);
    expect(q).toMatch(/@expiresAt < SYSUTCDATETIME\(\)/);
    expect(q).toMatch(/'igsid_taken'/);
    expect(q).toMatch(/UPDATE WebInstagramLinkCodes SET UsedAt = SYSUTCDATETIME\(\), UsedByIgsid = @igsid/);
    expect(q).not.toMatch(/\bTHROW\b|\bIIF\(/);
  });

  it('normaliza username ausente para null', async () => {
    mockPool({ recordset: [{ result: 'invalid', username: null }] });
    expect(await repo.consumeLinkCode('MUPRO-XXXXXX', '555', null)).toEqual({ result: 'invalid', username: null });
  });
});

describe('insertMention', () => {
  it('insere como received', async () => {
    const { queries } = mockPool({ rowsAffected: [1] });
    expect(await repo.insertMention({ mid: 'm1', igsid: '555', mediaUrl: 'u' })).toEqual({ inserted: true, status: 'received' });
    expect(queries[0]).toMatch(/VALUES \(@mid, @igsid, @mediaUrl, 'received'\)/);
  });

  it('mid duplicado devolve o status atual', async () => {
    const dup = Object.assign(new Error('dup'), { number: 2627 });
    mockPool(dup, { recordset: [{ status: 'rewarded' }] });
    expect(await repo.insertMention({ mid: 'm1', igsid: '555' })).toEqual({ inserted: false, status: 'rewarded' });
  });

  it('outros erros propagam', async () => {
    mockPool(new Error('boom'));
    await expect(repo.insertMention({ mid: 'm1', igsid: '555' })).rejects.toThrow('boom');
  });
});

describe('demais consultas', () => {
  it('createLinkCode apaga códigos não usados da conta antes de inserir', async () => {
    const { queries } = mockPool({ recordset: [{ expiresAt: 'x' }] });
    expect(await repo.createLinkCode('player1', 'MUPRO-ABC234', 30)).toBe('x');
    expect(queries[0]).toMatch(/DELETE FROM WebInstagramLinkCodes WHERE Username = @username AND UsedAt IS NULL/);
    expect(queries[0]).toMatch(/DATEADD\(minute, @ttlMinutes, SYSUTCDATETIME\(\)\)/);
  });

  it('retroativo busca unlinked/profile_error dentro da janela', async () => {
    const { queries } = mockPool({ recordset: [] });
    expect(await repo.findRetroactiveMention('555', 7)).toBeNull();
    expect(queries[0]).toMatch(/Status IN \('unlinked', 'profile_error'\)/);
    expect(queries[0]).toMatch(/DATEADD\(day, -@days, SYSUTCDATETIME\(\)\)/);
  });

  it('deleteLink devolve o vínculo removido', async () => {
    const { queries } = mockPool({ recordset: [{ igsid: '555', igUsername: 'fulano' }] });
    expect(await repo.deleteLink('player1')).toEqual({ igsid: '555', igUsername: 'fulano' });
    expect(queries[0]).toMatch(/OUTPUT DELETED.Igsid/);
  });
});
