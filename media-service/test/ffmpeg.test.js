const { test } = require('node:test');
const assert = require('node:assert');
const { runCommand, isAllowedFormat, ALLOWED_FORMATS, FORMAT_TO_EXT, VIDEO_FORMAT_TO_EXT } = require('../src/ffmpeg');

test('runCommand resolves with stdout on success', async () => {
  const { stdout } = await runCommand('node', ['-e', 'process.stdout.write("hello")']);
  assert.strictEqual(stdout, 'hello');
});

test('runCommand rejects on non-zero exit', async () => {
  await assert.rejects(() => runCommand('node', ['-e', 'process.exit(1)']));
});

test('runCommand never invokes a shell (argument with shell metacharacters is passed literally)', async () => {
  const { stdout } = await runCommand('node', ['-e', 'console.log(process.argv[1])', '$(echo pwned)']);
  assert.match(stdout, /\$\(echo pwned\)/);
});

test('isAllowedFormat accepts every value in ALLOWED_FORMATS', () => {
  assert.ok(ALLOWED_FORMATS.size > 0);
  for (const fmt of ALLOWED_FORMATS) {
    assert.strictEqual(isAllowedFormat(fmt), true, `expected allowlisted format "${fmt}" to be accepted`);
  }
});

test('isAllowedFormat rejects the dangerous concat demuxer', () => {
  assert.strictEqual(isAllowedFormat('concat'), false);
});

test('isAllowedFormat rejects an arbitrary unknown format (default-deny, not a blocklist)', () => {
  assert.strictEqual(isAllowedFormat('totally_made_up_format'), false);
});

test('isAllowedFormat rejects empty, non-string and near-miss values', () => {
  assert.strictEqual(isAllowedFormat(''), false);
  assert.strictEqual(isAllowedFormat(undefined), false);
  assert.strictEqual(isAllowedFormat(null), false);
  assert.strictEqual(isAllowedFormat('image2 '), false);
  assert.strictEqual(isAllowedFormat('MOV,MP4,M4A,3GP,3G2,MJ2'), false);
});

test('isAllowedFormat accepts jpeg_pipe (JPEG probed without a recognized extension)', () => {
  assert.strictEqual(isAllowedFormat('jpeg_pipe'), true);
});

test('FORMAT_TO_EXT maps validated image formats to the extension we serve', () => {
  assert.strictEqual(FORMAT_TO_EXT.image2, 'jpg');
  assert.strictEqual(FORMAT_TO_EXT.jpeg_pipe, 'jpg');
  assert.strictEqual(FORMAT_TO_EXT.png_pipe, 'png');
  assert.strictEqual(FORMAT_TO_EXT.webp_pipe, 'webp');
});

test('VIDEO_FORMAT_TO_EXT maps validated video containers to the extension we store', () => {
  assert.strictEqual(VIDEO_FORMAT_TO_EXT['mov,mp4,m4a,3gp,3g2,mj2'], 'mov');
  assert.strictEqual(VIDEO_FORMAT_TO_EXT['matroska,webm'], 'mkv');
  assert.strictEqual(VIDEO_FORMAT_TO_EXT.avi, 'avi');
});