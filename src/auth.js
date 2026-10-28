const crypto = require('crypto');

// Mesmo formato usado pelo servidor: scrypt$<salt>$<hash>
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

module.exports = { hashPassword };
