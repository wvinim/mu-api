const AppError = require('../utils/AppError');
const accountsRepository = require('../db/accountsRepository');
const charactersRepository = require('../db/charactersRepository');
const auditLog = require('../db/auditLogRepository');
const { getRole } = require('../services/roleService');

async function getMe(req, res, next) {
  try {
    const account = await accountsRepository.findByUsername(req.user.username);
    if (!account) throw new AppError(404, 'NOT_FOUND', 'Conta não encontrada.');

    res.json({
      username: account.username,
      displayName: account.displayName,
      email: account.email,
      role: getRole(account.username),
      emailConfirmed: account.emailConfirmed,
      cash: account.cash,
      vip: account.vip,
      vipStartDate: account.vipStartDate,
      vipEndDate: account.vipEndDate,
      createdAt: account.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const { displayName } = req.body;
    await accountsRepository.updateProfile(req.user.username, { displayName });
    await auditLog.record({
      accountId: req.user.username,
      username: req.user.username,
      eventType: 'account.update_profile',
      success: true,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ message: 'Perfil atualizado com sucesso.' });
  } catch (err) {
    next(err);
  }
}

async function getCharacters(req, res, next) {
  try {
    const characters = await charactersRepository.findByAccountId(req.user.username);
    res.json({ characters });
  } catch (err) {
    next(err);
  }
}

async function getSecurityLog(req, res, next) {
  try {
    const { page, limit } = req.query;
    const { items, total } = await auditLog.findByAccount(req.user.username, { page, limit });
    res.json({ page, limit, total, items });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateMe, getCharacters, getSecurityLog };
