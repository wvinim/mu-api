process.env.STAFF_USERNAMES = 'staffuser';

const request = require('supertest');

jest.mock('../src/db/supportTicketsRepository');
jest.mock('../src/db/auditLogRepository');

const app = require('../src/app');
const supportTicketsRepository = require('../src/db/supportTicketsRepository');
const tokenService = require('../src/services/tokenService');

function authHeader(username) {
  return `Bearer ${tokenService.issueAccessToken({ username })}`;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/v1/support/tickets', () => {
  it('cria um ticket com a mensagem inicial', async () => {
    supportTicketsRepository.createTicket.mockResolvedValue(42);

    const res = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', authHeader('player1'))
      .send({ subject: 'Problema no login', message: 'Não consigo entrar na conta.' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(42);
    expect(supportTicketsRepository.createTicket).toHaveBeenCalledWith({
      accountId: 'player1',
      subject: 'Problema no login',
      message: 'Não consigo entrar na conta.',
    });
  });
});

describe('GET /api/v1/support/tickets', () => {
  it('jogador comum vê só os próprios tickets', async () => {
    supportTicketsRepository.findByAccount.mockResolvedValue({ items: [], total: 0 });

    const res = await request(app).get('/api/v1/support/tickets').set('Authorization', authHeader('player1'));

    expect(res.status).toBe(200);
    expect(supportTicketsRepository.findByAccount).toHaveBeenCalledWith('player1', { page: 1, limit: 20, status: undefined });
    expect(supportTicketsRepository.findAll).not.toHaveBeenCalled();
  });

  it('staff vê os tickets abertos por padrão (sem os encerrados)', async () => {
    supportTicketsRepository.findAll.mockResolvedValue({ items: [], total: 0 });

    const res = await request(app).get('/api/v1/support/tickets').set('Authorization', authHeader('staffuser'));

    expect(res.status).toBe(200);
    expect(supportTicketsRepository.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, status: undefined });
    expect(supportTicketsRepository.findByAccount).not.toHaveBeenCalled();
  });

  it('staff consegue pedir explicitamente os tickets encerrados', async () => {
    supportTicketsRepository.findAll.mockResolvedValue({ items: [], total: 0 });

    const res = await request(app)
      .get('/api/v1/support/tickets?status=closed')
      .set('Authorization', authHeader('staffuser'));

    expect(res.status).toBe(200);
    expect(supportTicketsRepository.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, status: 'closed' });
  });
});

describe('GET /api/v1/support/tickets/:id', () => {
  it('retorna 404 quando outro jogador tenta ver um ticket que não é dele', async () => {
    supportTicketsRepository.findById.mockResolvedValue({ id: 1, accountId: 'player1', subject: 'x', status: 'open' });

    const res = await request(app).get('/api/v1/support/tickets/1').set('Authorization', authHeader('player2'));

    expect(res.status).toBe(404);
  });

  it('dono do ticket consegue ver, com as respostas', async () => {
    supportTicketsRepository.findById.mockResolvedValue({ id: 1, accountId: 'player1', subject: 'x', status: 'open' });
    supportTicketsRepository.findRepliesByTicket.mockResolvedValue([
      { id: 1, authorAccountId: 'player1', message: 'oi', createdAt: new Date() },
    ]);

    const res = await request(app).get('/api/v1/support/tickets/1').set('Authorization', authHeader('player1'));

    expect(res.status).toBe(200);
    expect(res.body.replies[0].authorRole).toBe('player');
  });

  it('staff consegue ver ticket de qualquer jogador', async () => {
    supportTicketsRepository.findById.mockResolvedValue({ id: 1, accountId: 'player1', subject: 'x', status: 'open' });
    supportTicketsRepository.findRepliesByTicket.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/support/tickets/1').set('Authorization', authHeader('staffuser'));

    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/support/tickets/:id/reply', () => {
  it('dono do ticket pode responder', async () => {
    supportTicketsRepository.findById.mockResolvedValue({ id: 1, accountId: 'player1', subject: 'x', status: 'open' });
    supportTicketsRepository.addReply.mockResolvedValue();

    const res = await request(app)
      .post('/api/v1/support/tickets/1/reply')
      .set('Authorization', authHeader('player1'))
      .send({ message: 'mais informações' });

    expect(res.status).toBe(201);
    expect(supportTicketsRepository.addReply).toHaveBeenCalledWith({ ticketId: 1, accountId: 'player1', message: 'mais informações' });
  });

  it('outro jogador não pode responder um ticket alheio', async () => {
    supportTicketsRepository.findById.mockResolvedValue({ id: 1, accountId: 'player1', subject: 'x', status: 'open' });

    const res = await request(app)
      .post('/api/v1/support/tickets/1/reply')
      .set('Authorization', authHeader('player2'))
      .send({ message: 'oi' });

    expect(res.status).toBe(404);
    expect(supportTicketsRepository.addReply).not.toHaveBeenCalled();
  });

  it('staff pode responder ticket de qualquer jogador', async () => {
    supportTicketsRepository.findById.mockResolvedValue({ id: 1, accountId: 'player1', subject: 'x', status: 'open' });
    supportTicketsRepository.addReply.mockResolvedValue();

    const res = await request(app)
      .post('/api/v1/support/tickets/1/reply')
      .set('Authorization', authHeader('staffuser'))
      .send({ message: 'resposta do suporte' });

    expect(res.status).toBe(201);
  });
});

describe('POST /api/v1/support/tickets/:id/close', () => {
  it('dono do ticket pode encerrar', async () => {
    supportTicketsRepository.findById.mockResolvedValue({ id: 1, accountId: 'player1', subject: 'x', status: 'open' });
    supportTicketsRepository.closeTicket.mockResolvedValue(true);

    const res = await request(app).post('/api/v1/support/tickets/1/close').set('Authorization', authHeader('player1'));

    expect(res.status).toBe(200);
    expect(supportTicketsRepository.closeTicket).toHaveBeenCalledWith(1);
  });

  it('staff pode encerrar ticket de qualquer jogador', async () => {
    supportTicketsRepository.findById.mockResolvedValue({ id: 1, accountId: 'player1', subject: 'x', status: 'open' });
    supportTicketsRepository.closeTicket.mockResolvedValue(true);

    const res = await request(app).post('/api/v1/support/tickets/1/close').set('Authorization', authHeader('staffuser'));

    expect(res.status).toBe(200);
  });

  it('outro jogador não pode encerrar um ticket alheio', async () => {
    supportTicketsRepository.findById.mockResolvedValue({ id: 1, accountId: 'player1', subject: 'x', status: 'open' });

    const res = await request(app).post('/api/v1/support/tickets/1/close').set('Authorization', authHeader('player2'));

    expect(res.status).toBe(404);
    expect(supportTicketsRepository.closeTicket).not.toHaveBeenCalled();
  });

  it('retorna 409 ao tentar encerrar um ticket já encerrado', async () => {
    supportTicketsRepository.findById.mockResolvedValue({ id: 1, accountId: 'player1', subject: 'x', status: 'closed' });

    const res = await request(app).post('/api/v1/support/tickets/1/close').set('Authorization', authHeader('player1'));

    expect(res.status).toBe(409);
    expect(supportTicketsRepository.closeTicket).not.toHaveBeenCalled();
  });
});
