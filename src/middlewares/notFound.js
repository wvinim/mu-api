const AppError = require('../utils/AppError');
const { scannerGuard } = require('./scannerGuard');

function notFound(req, res, next) {
  scannerGuard.addStrike(req);
  next(new AppError(404, 'NOT_FOUND', `Rota não encontrada: ${req.method} ${req.originalUrl}`));
}

module.exports = notFound;
