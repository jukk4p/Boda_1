const { test } = require('node:test');
const assert = require('node:assert');

test('path helpers build correct absolute paths under UPLOAD_ROOT', () => {
  process.env.UPLOAD_ROOT = '/tmp/uploads-test';
  delete require.cache[require.resolve('../src/paths')];
  const paths = require('../src/paths');
  assert.strictEqual(paths.originalPath('abc_123', 'jpg'), '/tmp/uploads-test/originals/abc_123.jpg');
  assert.strictEqual(paths.gridPath('abc_123'), '/tmp/uploads-test/grid/abc_123.jpg');
  assert.strictEqual(paths.posterPath('abc_123'), '/tmp/uploads-test/posters/abc_123.jpg');
  assert.strictEqual(paths.videoPath('abc_123'), '/tmp/uploads-test/video/abc_123.mp4');
  assert.strictEqual(paths.manifestPath(), '/tmp/uploads-test/manifest.jsonl');
});
