const bcrypt = require('bcrypt');

const env = require('../config/env');
const AppError = require('../utils/AppError');
const accountsRepository = require('../db/accountsRepository');
const auditLog = require('../db/auditLogRepository');
const tokenService = require('../services/tokenService');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

const BCRYPT_ROUNDS = 12;

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

async function register(req, res, next) {
  try {
    const { username, password, email } = req.body;
    const meta = requestMeta(req);

    const existing = await accountsRepository.findByUsername(username);
    if (existing) {
      await auditLog.record({ username, eventType: 'auth.register', success: false, ...meta, details: { reason: 'username_taken' } });
      throw new AppError(409, 'USERNAME_TAKEN', 'Este username já está em uso.');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    try {
      await accountsRepository.createAccount({ username, plainPassword: password, email, passwordHash });
    } catch (err) {
      // Corrida entre o SELECT acima e o INSERT: PK (memb___id) já existe.
      if (err.number === 2627 || err.number === 2601) {
        throw new AppError(409, 'USERNAME_TAKEN', 'Este username já está em uso.');
      }
      throw err;
    }

    const confirmToken = await tokenService.createAccountToken(username, 'email_confirm', env.emailTokenTtlHours);
    try {
      await emailService.sendConfirmationEmail(email, confirmToken);
    } catch (err) {
      logger.error({ err, username }, 'Falha ao enviar e-mail de confirmação no registro');
    }

    await auditLog.record({ accountId: username, username, eventType: 'auth.register', success: true, ...meta });

    res.status(201).json({
      message: 'Conta criada. Verifique seu e-mail para confirmar o cadastro antes de fazer login.',
    });
  } catch (err) {
    next(err);
  }
}

async function confirmEmail(req, res, next) {
  try {
    const { token } = req.body;
    const accountId = await tokenService.consumeAccountToken(token, 'email_confirm');
    await accountsRepository.setEmailConfirmed(accountId);
    await auditLog.record({ accountId, username: accountId, eventType: 'auth.email_confirmed', success: true, ...requestMeta(req) });
    res.json({ message: 'E-mail confirmado com sucesso.' });
  } catch (err) {
    next(err);
  }
}

async function resendConfirmation(req, res, next) {
  try {
    const { email } = req.body;
    const accounts = await accountsRepository.findAllByEmail(email);

    // Nunca revela se o e-mail existe/quantas contas usam o mesmo e-mail.
    if (accounts.length === 1 && !accounts[0].emailConfirmed) {
      const token = await tokenService.createAccountToken(accounts[0].username, 'email_confirm', env.emailTokenTtlHours);
      try {
        await emailService.sendConfirmationEmail(email, token);
      } catch (err) {
        logger.error({ err, email }, 'Falha ao reenviar e-mail de confirmação');
      }
    }

    res.json({ message: 'Se o e-mail existir e ainda não tiver sido confirmado, enviamos um novo link.' });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const meta = requestMeta(req);

    const account = await accountsRepository.findByUsername(username);
    if (!account || !account.webPasswordHash) {
      await auditLog.record({ username, eventType: 'auth.login', success: false, ...meta, details: { reason: 'not_found' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Usuário ou senha inválidos.');
    }

    if (account.banned) {
      await auditLog.record({ accountId: username, username, eventType: 'auth.login', success: false, ...meta, details: { reason: 'banned' } });
      throw new AppError(403, 'ACCOUNT_BANNED', 'Esta conta está banida.');
    }

    const passwordMatches = await bcrypt.compare(password, account.webPasswordHash);
    if (!passwordMatches) {
      await auditLog.record({ accountId: username, username, eventType: 'auth.login', success: false, ...meta, details: { reason: 'wrong_password' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Usuário ou senha inválidos.');
    }

    if (!account.emailConfirmed) {
      await auditLog.record({ accountId: username, username, eventType: 'auth.login', success: false, ...meta, details: { reason: 'email_not_confirmed' } });
      throw new AppError(403, 'EMAIL_NOT_CONFIRMED', 'Confirme seu e-mail antes de fazer login.');
    }

    const accessToken = tokenService.issueAccessToken(account);
    const refreshToken = await tokenService.issueRefreshToken(account, meta.ipAddress ? { ip: meta.ipAddress, userAgent: meta.userAgent } : {});

    await auditLog.record({ accountId: username, username, eventType: 'auth.login', success: true, ...meta });

    res.json({ accessToken, refreshToken, expiresIn: env.jwt.accessExpiresIn });
  } catch (err) {
    next(err);
  }
}

async function refreshTokenHandler(req, res, next) {
  try {
    const { refreshToken } = req.body;
    const meta = requestMeta(req);
    const result = await tokenService.rotateRefreshToken(refreshToken, { ip: meta.ipAddress, userAgent: meta.userAgent });
    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: env.jwt.accessExpiresIn,
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    await tokenService.revokeRefreshToken(refreshToken);
    res.json({ message: 'Sessão encerrada.' });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const accounts = await accountsRepository.findAllByEmail(email);

    if (accounts.length === 1) {
      const token = await tokenService.createAccountToken(accounts[0].username, 'password_reset', env.passwordResetTokenTtlHours);
      try {
        await emailService.sendPasswordResetEmail(email, token);
      } catch (err) {
        logger.error({ err, email }, 'Falha ao enviar e-mail de redefinição de senha');
      }
    } else if (accounts.length > 1) {
      // Mais de uma conta com o mesmo e-mail: não há como saber qual o
      // usuário quer redefinir com segurança — não envia, só audita.
      await auditLog.record({ username: null, eventType: 'auth.forgot_password', success: false, ...requestMeta(req), details: { reason: 'ambiguous_email', email } });
    }

    // Nunca revela se o e-mail existe na resposta (mesmo texto sempre).
    res.json({ message: 'Se o e-mail existir, enviaremos instruções para redefinir a senha.' });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;
    const accountId = await tokenService.consumeAccountToken(token, 'password_reset');
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await accountsRepository.updatePasswordBoth(accountId, { plainPassword: password, passwordHash });
    await tokenService.revokeAllRefreshTokensForAccount(accountId);
    await auditLog.record({ accountId, username: accountId, eventType: 'auth.reset_password', success: true, ...requestMeta(req) });
    res.json({ message: 'Senha redefinida com sucesso.' });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const { username } = req.user;
    const meta = requestMeta(req);

    const account = await accountsRepository.findByUsername(username);
    const passwordMatches = account?.webPasswordHash && (await bcrypt.compare(currentPassword, account.webPasswordHash));
    if (!passwordMatches) {
      await auditLog.record({ accountId: username, username, eventType: 'auth.change_password', success: false, ...meta });
      throw new AppError(401, 'INVALID_CURRENT_PASSWORD', 'Senha atual incorreta.');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await accountsRepository.updatePasswordBoth(username, { plainPassword: newPassword, passwordHash });
    await tokenService.revokeAllRefreshTokensForAccount(username);
    await auditLog.record({ accountId: username, username, eventType: 'auth.change_password', success: true, ...meta });

    res.json({ message: 'Senha alterada com sucesso. Faça login novamente.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  confirmEmail,
  resendConfirmation,
  login,
  refreshTokenHandler,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
};
