const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../utils/AppError');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Token de acesso ausente.'));
  }

  try {
    const payload = jwt.verify(token, env.jwt.accessSecret);
    if (payload.type !== 'access') {
      throw new Error('wrong token type');
    }
    req.user = { username: payload.sub, role: payload.role };
    return next();
  } catch {
    return next(new AppError(401, 'UNAUTHORIZED', 'Token de acesso inválido ou expirado.'));
  }
}

module.exports = requireAuth;
