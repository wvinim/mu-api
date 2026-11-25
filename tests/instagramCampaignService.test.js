process.env.INSTAGRAM_CAMPAIGN_ENABLED = 'true';
process.env.INSTAGRAM_REWARD_CASH = '40';
process.env.INSTAGRAM_MIN_FOLLOWERS = '50';
process.env.INSTAGRAM_RETROACTIVE_DAYS = '7';
process.env.INSTAGRAM_HANDLE = 'muproserver';

jest.mock('../src/db/instagramRepository');
jest.mock('../src/services/instagramGraph');
jest.mock('../src/db/auditLogRepository');

const repo = require('../src/db/instagramRepository');
const graph = require('../src/services/instagramGraph');
const auditLog = require('../src/db/auditLogRepository');
const env = require('../src/config/env');
const service = require('../src/services/instagramCampaignService');

const IG_ACCOUNT = '17841440190434640';

function mentionPayload({ igsid = '555', mid = 'm1' } = {}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: IG_ACCOUNT,
        messaging: [
          {
            sender: { id: igsid },
            recipient: { id: IG_ACCOUNT },
            message: { mid, attachments: [{ type: 'story_mention', payload: { url: 'https://cdn/x' } }] },
          },
        ],
      },
    ],
  };
}

function textPayload(text, { igsid = '555', echo = false } = {}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: IG_ACCOUNT,
        messaging: [
          { sender: { id: igsid }, recipient: { id: IG_ACCOUNT }, message: { mid: 'mt', text, is_echo: echo } },
        ],
      },
    ],
  };
}

// As respostas saem em segundo plano; espera a fila de microtasks esvaziar.
const flush = () => new Promise((resolve) => setImmediate(resolve));

function sentTexts() {
  return graph.sendText.mock.calls.map((call) => call[2]);
}

beforeEach(() => {
  jest.clearAllMocks();
  env.instagram.campaignEnabled = true;
  env.instagram.testers = [];
  repo.isUniqueViolation.mockImplementation((err) => err && err.number === 2627);
  repo.insertMention.mockResolvedValue({ inserted: true, status: 'received' });
  repo.findLinkByIgsid.mockResolvedValue({ username: 'player1', igsid: '555' });
  repo.findRewardByIgsid.mockResolvedValue(null);
  repo.rewardMention.mockResolvedValue('rewarded');
  repo.findRetroactiveMention.mockResolvedValue(null);
  graph.fetchProfile.mockResolvedValue({ username: 'fulano', followerCount: 152 });
  graph.sendText.mockResolvedValue();
});

describe('extractCode', () => {
  it.each([
    ['MUPRO-ABC234', 'MUPRO-ABC234'],
    ['meu código: mupro-abc234 obrigado', 'MUPRO-ABC234'],
    ['MUPRO ABC234', 'MUPRO-ABC234'],
    ['MUPROABC234', 'MUPRO-ABC234'],
  ])('%s → %s', (text, expected) => {
    expect(service.extractCode(text)).toBe(expected);
  });

  it.each([['oi'], ['MUPRO-ABC'], [undefined], ['MUPRO-ABC2345']])('ignora %s', (text) => {
    expect(service.extractCode(text)).toBeNull();
  });

  it('generateCode gera códigos no formato aceito', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = service.generateCode();
      expect(code).toMatch(/^MUPRO-[A-HJ-NP-Z2-9]{6}$/);
      expect(service.extractCode(code)).toBe(code);
    }
  });
});

describe('story_mention', () => {
  it('vinculado, 50+ seguidores, nunca premiado → credita, audita e responde', async () => {
    await service.handleWebhook(mentionPayload());
    await flush();

    expect(repo.rewardMention).toHaveBeenCalledWith({
      mid: 'm1',
      igsid: '555',
      username: 'player1',
      igUsername: 'fulano',
      followerCount: 152,
      amount: 40,
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'instagram.story_reward', accountId: 'player1' }),
    );
    expect(graph.sendText).toHaveBeenCalledWith(IG_ACCOUNT, '555', expect.stringContaining('40 gold foram creditados'));
  });

  it('nunca manda o login da conta no Direct', async () => {
    await service.handleWebhook(mentionPayload());
    await flush();
    expect(sentTexts().join(' ')).not.toContain('player1');
  });

  it('menos de 50 seguidores → low_followers, sem crédito', async () => {
    graph.fetchProfile.mockResolvedValue({ username: 'fulano', followerCount: 49 });
    await service.handleWebhook(mentionPayload());
    await flush();
    expect(repo.rewardMention).not.toHaveBeenCalled();
    expect(repo.updateMention).toHaveBeenCalledWith('m1', expect.objectContaining({ status: 'low_followers', followerCount: 49 }));
    expect(sentTexts()[0]).toContain('pelo menos 50 seguidores');
  });

  it('follower_count ausente conta como insuficiente', async () => {
    graph.fetchProfile.mockResolvedValue({ username: 'fulano', followerCount: null });
    await service.handleWebhook(mentionPayload());
    expect(repo.rewardMention).not.toHaveBeenCalled();
  });

  it('Instagram já premiado → already_rewarded, sem consultar perfil', async () => {
    repo.findRewardByIgsid.mockResolvedValue({ username: 'outra', amount: 40 });
    await service.handleWebhook(mentionPayload());
    await flush();
    expect(graph.fetchProfile).not.toHaveBeenCalled();
    expect(repo.rewardMention).not.toHaveBeenCalled();
    expect(repo.updateMention).toHaveBeenCalledWith('m1', expect.objectContaining({ status: 'already_rewarded' }));
  });

  it('corrida: o banco diz already_rewarded → não audita crédito', async () => {
    repo.rewardMention.mockResolvedValue('already_rewarded');
    await service.handleWebhook(mentionPayload());
    expect(auditLog.record).not.toHaveBeenCalled();
    expect(repo.updateMention).toHaveBeenCalledWith('m1', expect.objectContaining({ status: 'already_rewarded' }));
  });

  it('reenvio da Meta (mid já resolvido) → não faz nada', async () => {
    repo.insertMention.mockResolvedValue({ inserted: false, status: 'rewarded' });
    await service.handleWebhook(mentionPayload());
    await flush();
    expect(repo.findLinkByIgsid).not.toHaveBeenCalled();
    expect(repo.rewardMention).not.toHaveBeenCalled();
    expect(graph.sendText).not.toHaveBeenCalled();
  });

  it('reenvio de mid com profile_error → reprocessa', async () => {
    repo.insertMention.mockResolvedValue({ inserted: false, status: 'profile_error' });
    await service.handleWebhook(mentionPayload());
    expect(repo.rewardMention).toHaveBeenCalled();
  });

  it('falha na consulta de perfil → profile_error e erro propagado (webhook 500)', async () => {
    graph.fetchProfile.mockRejectedValue(new Error('graph down'));
    await expect(service.handleWebhook(mentionPayload())).rejects.toThrow('graph down');
    expect(repo.updateMention).toHaveBeenCalledWith('m1', expect.objectContaining({ status: 'profile_error' }));
    expect(repo.rewardMention).not.toHaveBeenCalled();
  });

  it('sem vínculo → unlinked e convite para vincular', async () => {
    repo.findLinkByIgsid.mockResolvedValue(null);
    await service.handleWebhook(mentionPayload());
    await flush();
    expect(repo.updateMention).toHaveBeenCalledWith('m1', { status: 'unlinked' });
    expect(sentTexts()[0]).toContain('vincule este Instagram');
  });

  it('campanha desligada: sem vínculo → disabled, sem resposta', async () => {
    env.instagram.campaignEnabled = false;
    repo.findLinkByIgsid.mockResolvedValue(null);
    await service.handleWebhook(mentionPayload());
    await flush();
    expect(repo.updateMention).toHaveBeenCalledWith('m1', { status: 'disabled' });
    expect(graph.sendText).not.toHaveBeenCalled();
  });

  it('campanha desligada: conta comum → disabled; tester → premiado', async () => {
    env.instagram.campaignEnabled = false;
    await service.handleWebhook(mentionPayload());
    expect(repo.rewardMention).not.toHaveBeenCalled();
    expect(repo.updateMention).toHaveBeenCalledWith('m1', expect.objectContaining({ status: 'disabled' }));

    env.instagram.testers = ['player1'];
    await service.handleWebhook(mentionPayload());
    expect(repo.rewardMention).toHaveBeenCalled();
  });

  it('falha ao responder no Direct não derruba o webhook', async () => {
    graph.sendText.mockRejectedValue(new Error('send failed'));
    await expect(service.handleWebhook(mentionPayload())).resolves.toBeUndefined();
    await flush();
  });
});

describe('código de vínculo no Direct', () => {
  it('vincula e responde com instrução do story', async () => {
    repo.consumeLinkCode.mockResolvedValue({ result: 'linked', username: 'player1' });
    await service.handleWebhook(textPayload('MUPRO-ABC234'));
    await flush();
    expect(repo.consumeLinkCode).toHaveBeenCalledWith('MUPRO-ABC234', '555', 'fulano');
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'instagram.link' }));
    expect(sentTexts()[0]).toContain('Instagram vinculado');
    expect(sentTexts()[0]).toContain('@muproserver');
    expect(sentTexts().join(' ')).not.toContain('player1');
  });

  it('vínculo premia story retroativo (até 7 dias)', async () => {
    repo.consumeLinkCode.mockResolvedValue({ result: 'linked', username: 'player1' });
    repo.findRetroactiveMention.mockResolvedValue({ mid: 'old-mid' });
    await service.handleWebhook(textPayload('MUPRO-ABC234'));
    await flush();
    expect(repo.findRetroactiveMention).toHaveBeenCalledWith('555', 7);
    expect(repo.rewardMention).toHaveBeenCalledWith(expect.objectContaining({ mid: 'old-mid', username: 'player1' }));
    expect(sentTexts()).toHaveLength(2);
  });

  it('Instagram já premiado: vincula sem retroativo', async () => {
    repo.consumeLinkCode.mockResolvedValue({ result: 'linked', username: 'player1' });
    repo.findRewardByIgsid.mockResolvedValue({ username: 'outra' });
    await service.handleWebhook(textPayload('MUPRO-ABC234'));
    await flush();
    expect(repo.findRetroactiveMention).not.toHaveBeenCalled();
    expect(sentTexts()[0]).toContain('já recebeu o prêmio');
  });

  it('reenvio do mesmo Direct (already_linked) não audita de novo', async () => {
    repo.consumeLinkCode.mockResolvedValue({ result: 'already_linked', username: 'player1' });
    await service.handleWebhook(textPayload('MUPRO-ABC234'));
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it.each([['invalid'], ['expired']])('código %s → resposta de código inválido', async (result) => {
    repo.consumeLinkCode.mockResolvedValue({ result, username: null });
    await service.handleWebhook(textPayload('MUPRO-ABC234'));
    await flush();
    expect(sentTexts()[0]).toContain('Código inválido ou expirado');
  });

  it('Instagram vinculado a outra conta → aviso', async () => {
    repo.consumeLinkCode.mockResolvedValue({ result: 'igsid_taken', username: null });
    await service.handleWebhook(textPayload('MUPRO-ABC234'));
    await flush();
    expect(sentTexts()[0]).toContain('já está vinculado a outra conta');
  });

  it('perfil indisponível não impede o vínculo', async () => {
    graph.fetchProfile.mockRejectedValue(new Error('graph down'));
    repo.consumeLinkCode.mockResolvedValue({ result: 'linked', username: 'player1' });
    await service.handleWebhook(textPayload('MUPRO-ABC234'));
    expect(repo.consumeLinkCode).toHaveBeenCalledWith('MUPRO-ABC234', '555', null);
  });

  it('mensagem comum, eco do próprio perfil ou sem código → ignorada', async () => {
    await service.handleWebhook(textPayload('oi, tudo bem?'));
    await service.handleWebhook(textPayload('MUPRO-ABC234', { echo: true }));
    await service.handleWebhook(textPayload('MUPRO-ABC234', { igsid: IG_ACCOUNT }));
    await flush();
    expect(repo.consumeLinkCode).not.toHaveBeenCalled();
    expect(graph.sendText).not.toHaveBeenCalled();
  });
});

describe('site', () => {
  it('createLinkCode tenta de novo quando o código colide', async () => {
    const dup = Object.assign(new Error('dup'), { number: 2627 });
    repo.createLinkCode.mockRejectedValueOnce(dup).mockResolvedValueOnce('2026-11-25T12:30:00Z');
    const out = await service.createLinkCode('player1');
    expect(repo.createLinkCode).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ code: expect.stringMatching(/^MUPRO-/), expiresAt: '2026-11-25T12:30:00Z', instagramHandle: 'muproserver' });
  });

  it('getStatus sem vínculo', async () => {
    repo.findLinkByUsername.mockResolvedValue(null);
    const out = await service.getStatus('player1');
    expect(out).toMatchObject({ campaignEnabled: true, rewardCash: 40, minFollowers: 50, link: null, reward: null });
  });

  it('getStatus com vínculo e prêmio de outra conta', async () => {
    repo.findLinkByUsername.mockResolvedValue({ igsid: '555', igUsername: 'fulano', linkedAt: 'd1' });
    repo.findRewardByIgsid.mockResolvedValue({ username: 'outra', amount: 40, createdAt: 'd0' });
    repo.findLastMention.mockResolvedValue({ status: 'already_rewarded', followerCount: 152, createdAt: 'd2' });
    const out = await service.getStatus('player1');
    expect(out.link).toEqual({ igUsername: 'fulano', linkedAt: 'd1' });
    expect(out.reward).toEqual({ amount: 40, createdAt: 'd0', toThisAccount: false });
    expect(out.lastMention.status).toBe('already_rewarded');
  });
});
