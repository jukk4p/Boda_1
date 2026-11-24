const { test } = require('node:test');
const assert = require('node:assert');
const { generateId, sanitizeExt } = require('../src/id');

test('generateId matches timestamp_hex32 shape', () => {
  const id = generateId();
  assert.match(id, /^\d+_[0-9a-f]{32}$/);
});

test('generateId produces distinct ids', () => {
  assert.notStrictEqual(generateId(), generateId());
});

test('sanitizeExt lowercases and strips non-alphanumerics', () => {
  assert.strictEqual(sanitizeExt('IMG_0231.JPG'), 'jpg');
  assert.strictEqual(sanitizeExt('clip.mov'), 'mov');
});

test('sanitizeExt falls back to bin for no extension', () => {
  assert.strictEqual(sanitizeExt('noext'), 'bin');
  assert.strictEqual(sanitizeExt(''), 'bin');
});
