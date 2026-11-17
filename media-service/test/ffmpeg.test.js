const { test } = require('node:test');
const assert = require('node:assert');
const { runCommand, isAllowedFormat, isHeicBrand, ALLOWED_FORMATS, FORMAT_TO_EXT, VIDEO_FORMAT_TO_EXT } = require('../src/ffmpeg');

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

// HEIC/HEIF stills are demuxed by the exact same ffmpeg "mov" family as real
// MP4/MOV video, so format_name alone can't tell a HEIC photo from an MP4
// video apart (see ffmpeg.js's MOV_FAMILY_FORMAT comment). detectAndValidateFormat
// disambiguates via the ftyp box's major_brand/compatible_brands tags instead.
// isHeicBrand is the pure, synchronous piece of that logic, so it's covered
// here without spawning ffprobe or needing a real .heic sample file.

test('isHeicBrand recognizes still-image HEIC/HEIF major_brand values (IANA image/heic, image/heif registrations)', () => {
  assert.strictEqual(isHeicBrand('heic', ''), true);
  assert.strictEqual(isHeicBrand('heix', ''), true);
  assert.strictEqual(isHeicBrand('heim', ''), true);
  assert.strictEqual(isHeicBrand('heis', ''), true);
  assert.strictEqual(isHeicBrand('mif1', ''), true);
});

test('isHeicBrand recognizes HEIC/HEIF image-sequence brands (MP4RA brand registry) via compatible_brands', () => {
  // Real-world iPhone HEIC output: major_brand=heic, compatible_brands="mif1heic".
  assert.strictEqual(isHeicBrand('heic', 'mif1heic'), true);
  assert.strictEqual(isHeicBrand('msf1', ''), true);
  assert.strictEqual(isHeicBrand('msf1', 'hevchevx'), true);
});

test('isHeicBrand rejects a real MP4 brand pairing (no HEIC/HEIF brand anywhere)', () => {
  // Real ffmpeg-generated mp4: major_brand=isom, compatible_brands=isomiso2avc1mp41.
  assert.strictEqual(isHeicBrand('isom', 'isomiso2avc1mp41'), false);
});

test('isHeicBrand only matches compatible_brands on exact 4-byte boundaries, not any substring', () => {
  // "heic" appears as a substring spanning two unrelated 4-byte brand codes
  // ("xhei" + "cxyz"), but not aligned to a real brand boundary -- must not match.
  assert.strictEqual(isHeicBrand('isom', 'xheicxyz'), false);
});

test('isHeicBrand is safe against non-string / missing brand values', () => {
  assert.strictEqual(isHeicBrand(undefined, undefined), false);
  assert.strictEqual(isHeicBrand(null, null), false);
  assert.strictEqual(isHeicBrand('', ''), false);
});

test('ALLOWED_FORMATS/FORMAT_TO_EXT accept the synthetic "heic" key detectAndValidateFormat returns for HEIC content', () => {
  assert.ok(ALLOWED_FORMATS.has('heic'));
  assert.strictEqual(FORMAT_TO_EXT.heic, 'heic');
});

test('VIDEO_FORMAT_TO_EXT never gets a heic entry (no collision with the photo pipeline)', () => {
  assert.strictEqual(VIDEO_FORMAT_TO_EXT.heic, undefined);
});