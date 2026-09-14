const crypto = require('crypto');

function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = { generateOpaqueToken, sha256Hex };
