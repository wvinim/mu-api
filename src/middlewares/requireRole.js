const AppError = require('../utils/AppError');

const ROLE_RANK = { player: 0, staff: 1, admin: 2 };

/** Uso: requireRole('staff') libera staff e admin; requireRole('admin') só admin. */
function requireRole(minRole) {
  const minRank = ROLE_RANK[minRole];
  return (req, res, next) => {
    const rank = ROLE_RANK[req.user?.role];
    if (rank === undefined || rank < minRank) {
      return next(new AppError(403, 'FORBIDDEN', 'Você não tem permissão para acessar este recurso.'));
    }
    return next();
  };
}

module.exports = requireRole;
