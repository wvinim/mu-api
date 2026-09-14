const env = require('../config/env');

/**
 * Papel (role) definido por lista fixa no .env — decisão tomada com o
 * usuário porque ctl1_code não representa isso neste core (fica sempre 0).
 * Trocar de staff/admin exige editar ADMIN_USERNAMES/STAFF_USERNAMES e
 * reiniciar o processo.
 */
function getRole(username) {
  if (env.roles.adminUsernames.includes(username)) return 'admin';
  if (env.roles.staffUsernames.includes(username)) return 'staff';
  return 'player';
}

module.exports = { getRole };
