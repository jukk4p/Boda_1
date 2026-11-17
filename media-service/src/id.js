const crypto = require('crypto');

function generateId() {
  return `${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
}

function sanitizeExt(filename) {
  const name = filename || '';
  const dot = name.lastIndexOf('.');
  const raw = dot >= 0 ? name.slice(dot + 1) : '';
  const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean || 'bin';
}

module.exports = { generateId, sanitizeExt };
