const AppError = require('../utils/AppError');
const supportTicketsRepository = require('../db/supportTicketsRepository');
const auditLog = require('../db/auditLogRepository');
const { getRole } = require('../services/roleService');

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

function isStaffOrAdmin(req) {
  return req.user.role === 'staff' || req.user.role === 'admin';
}

async function createTicket(req, res, next) {
  try {
    const { subject, message } = req.body;
    const username = req.user.username;

    const ticketId = await supportTicketsRepository.createTicket({ accountId: username, subject, message });

    await auditLog.record({
      accountId: username,
      username,
      eventType: 'support.ticket_created',
      success: true,
      ...requestMeta(req),
      details: { ticketId },
    });

    res.status(201).json({ id: ticketId, subject, status: 'open' });
  } catch (err) {
    next(err);
  }
}

async function listTickets(req, res, next) {
  try {
    const { page, limit } = req.query;
    const result = isStaffOrAdmin(req)
      ? await supportTicketsRepository.findAll({ page, limit })
      : await supportTicketsRepository.findByAccount(req.user.username, { page, limit });

    res.json({ page, limit, total: result.total, items: result.items });
  } catch (err) {
    next(err);
  }
}

async function assertCanAccessTicket(req, ticket) {
  if (!ticket) {
    throw new AppError(404, 'NOT_FOUND', 'Ticket não encontrado.');
  }
  const isOwner = ticket.accountId === req.user.username;
  if (!isOwner && !isStaffOrAdmin(req)) {
    // 404 em vez de 403: não confirma pra outro player que o ticket existe.
    throw new AppError(404, 'NOT_FOUND', 'Ticket não encontrado.');
  }
}

async function getTicket(req, res, next) {
  try {
    const ticket = await supportTicketsRepository.findById(req.params.id);
    await assertCanAccessTicket(req, ticket);

    const replies = await supportTicketsRepository.findRepliesByTicket(ticket.id);
    res.json({
      ...ticket,
      replies: replies.map((r) => ({ ...r, authorRole: getRole(r.authorAccountId) })),
    });
  } catch (err) {
    next(err);
  }
}

async function replyTicket(req, res, next) {
  try {
    const { message } = req.body;
    const ticket = await supportTicketsRepository.findById(req.params.id);
    await assertCanAccessTicket(req, ticket);

    await supportTicketsRepository.addReply({ ticketId: ticket.id, accountId: req.user.username, message });

    await auditLog.record({
      accountId: req.user.username,
      username: req.user.username,
      eventType: 'support.ticket_reply',
      success: true,
      ...requestMeta(req),
      details: { ticketId: ticket.id },
    });

    res.status(201).json({ message: 'Resposta adicionada.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { createTicket, listTickets, getTicket, replyTicket };
