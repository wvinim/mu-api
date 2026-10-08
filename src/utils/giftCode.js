const crypto = require('crypto');

// Sem 0/O, 1/I/L: a chave é digitada à mão a partir de um e-mail/print.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PREFIX = 'MUPRO';
const GROUPS = 4;
const GROUP_SIZE = 4;
const BODY_LENGTH = GROUPS * GROUP_SIZE; // 16 chars ≈ 79 bits de entropia

function formatBody(body) {
  const groups = [];
  for (let i = 0; i < body.length; i += GROUP_SIZE) groups.push(body.slice(i, i + GROUP_SIZE));
  return [PREFIX, ...groups].join('-');
}

/** Gera uma chave nova no formato canônico MUPRO-XXXX-XXXX-XXXX-XXXX. */
function generate() {
  let body = '';
  for (let i = 0; i < BODY_LENGTH; i += 1) body += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return formatBody(body);
}

/**
 * Normaliza o que o usuário digitou para o formato canônico: ignora
 * maiúsculas/minúsculas, espaços, hífens e o prefixo opcional. Retorna null
 * se não tem cara de chave (não vale a pena consultar o banco).
 */
function normalize(input) {
  let body = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (body.length === PREFIX.length + BODY_LENGTH && body.startsWith(PREFIX)) body = body.slice(PREFIX.length);
  if (body.length !== BODY_LENGTH) return null;
  for (const ch of body) if (!ALPHABET.includes(ch)) return null;
  return formatBody(body);
}

/** Só os últimos 4 caracteres — para auditoria/log, nunca a chave inteira. */
function hint(code) {
  return String(code).slice(-4);
}

module.exports = { generate, normalize, hint };
