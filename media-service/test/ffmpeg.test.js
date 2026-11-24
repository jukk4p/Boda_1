const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  runCommand, isAllowedFormat, isHeicBrand, parseFtypBrandTags, detectAndValidateFormat,
  ALLOWED_FORMATS, FORMAT_TO_EXT, VIDEO_FORMAT_TO_EXT
} = require('../src/ffmpeg');

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

test('parseFtypBrandTags parses ffprobe\'s "TAG:key=value" output lines for major_brand/compatible_brands', () => {
  const stdout = 'TAG:major_brand=heic\nTAG:compatible_brands=mif1heic\n';
  assert.deepStrictEqual(parseFtypBrandTags(stdout), { major_brand: 'heic', compatible_brands: 'mif1heic' });
});

test('parseFtypBrandTags tolerates missing tags and ignores unrelated lines', () => {
  assert.deepStrictEqual(parseFtypBrandTags(''), {});
  assert.deepStrictEqual(parseFtypBrandTags('TAG:major_brand=isom\n'), { major_brand: 'isom' });
  assert.deepStrictEqual(
    parseFtypBrandTags('some unrelated line\nTAG:compatible_brands=isomiso2avc1mp41'),
    { compatible_brands: 'isomiso2avc1mp41' }
  );
});

// --- detectAndValidateFormat: real-file integration coverage of the { key, demuxer } remap itself ---
//
// These two tests exercise detectAndValidateFormat end to end against a REAL
// ffprobe process (not a mock of isHeicBrand/parseFtypBrandTags in
// isolation), because that's what caught the critical bug in the first
// version of this fix: detectAndValidateFormat returned the synthetic
// 'heic' string directly, and processPhoto.js passed it straight into
// ffmpeg's `-f` flag -- there is no such demuxer, so every real HEIC upload
// threw "Unknown input format: 'heic'" (reproduced locally:
// `ffmpeg -f heic -i out.mp4 ...` -> "[in#0] Unknown input format: 'heic'").
// The fix returns { key, demuxer } so `-f` always gets the real demuxer.
//
// A genuine iPhone .heic sample isn't available in this environment (no
// Docker, no sample file). Confirmed locally that a synthetic ftyp-only stub
// is NOT a usable substitute: `ffprobe -show_entries format_tags=...` on an
// ftyp-only file fails with "moov atom not found" (ffprobe needs a full
// moov tree to open the file at all, not just the ftyp box). Instead, these
// tests generate a REAL, valid mp4 with real ffmpeg and byte-patch its ftyp
// box's major_brand field in place (same 4-byte length, rest of the
// container -- moov/mdat -- untouched), which produces a file real ffprobe
// opens and demuxes normally (format_name unaffected) while reporting
// major_brand=heic -- the exact signal isHeicBrand looks for. This exercises
// detectAndValidateFormat's real remap logic against a real ffprobe process,
// without needing an actual HEIC sample. verificado por investigación +
// prueba local con ffmpeg real disponible en esta máquina (ffmpeg/ffprobe
// 8.1, gyan.dev Windows build) -- no confirmado todavía contra un .heic real
// de iPhone ni contra el build de ffmpeg de Alpine en el contenedor; esa
// confirmación final sigue pendiente (ver comentario de HEIC_FAMILY_BRANDS
// en ffmpeg.js).
//
// Both tests skip gracefully (not fail) if ffmpeg/ffprobe aren't on PATH, to
// keep this suite runnable in environments without them (as the rest of
// this file deliberately is, by only ever invoking `node` as a stand-in
// command).

async function ffmpegToolsAvailable() {
  try {
    await runCommand('ffprobe', ['-version']);
    await runCommand('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

function makeTempMp4(dir) {
  const mp4Path = path.join(dir, 'source.mp4');
  return runCommand('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=1',
    '-c:v', 'libx264', '-t', '1', mp4Path
  ]).then(() => mp4Path);
}

test('detectAndValidateFormat: a real non-HEIC mp4 resolves key === demuxer === the raw format_name (unchanged behavior)', async (t) => {
  if (!(await ffmpegToolsAvailable())) {
    t.skip('ffmpeg/ffprobe not found on PATH in this environment');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-heic-test-'));
  try {
    const mp4Path = await makeTempMp4(dir);
    const result = await detectAndValidateFormat(mp4Path);
    assert.strictEqual(result.demuxer, 'mov,mp4,m4a,3gp,3g2,mj2');
    assert.strictEqual(result.key, result.demuxer);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectAndValidateFormat: an mp4 container whose ftyp major_brand is patched to "heic" resolves key==="heic" while demuxer stays the raw mov format_name', async (t) => {
  if (!(await ffmpegToolsAvailable())) {
    t.skip('ffmpeg/ffprobe not found on PATH in this environment');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-heic-test-'));
  try {
    const mp4Path = await makeTempMp4(dir);
    const buf = fs.readFileSync(mp4Path);
    const majorBrandOffset = buf.indexOf('ftyp') + 4;
    assert.strictEqual(
      buf.toString('ascii', majorBrandOffset, majorBrandOffset + 4), 'isom',
      'fixture assumption: this ffmpeg build writes major_brand=isom at this offset'
    );
    buf.write('heic', majorBrandOffset, 'ascii');
    const heicLikePath = path.join(dir, 'patched.heic');
    fs.writeFileSync(heicLikePath, buf);

    const result = await detectAndValidateFormat(heicLikePath);
    // -f target: must always be the real demuxer, never the synthetic key.
    assert.strictEqual(result.demuxer, 'mov,mp4,m4a,3gp,3g2,mj2');
    // FORMAT_TO_EXT/VIDEO_FORMAT_TO_EXT lookup target: the synthetic key.
    assert.strictEqual(result.key, 'heic');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});