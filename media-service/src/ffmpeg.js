const { spawn } = require('child_process');

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: stdout.trim() });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}

const runFfmpeg = (args) => runCommand('ffmpeg', args);
const runFfprobe = (args) => runCommand('ffprobe', args);

// Default-deny allowlist of ffprobe `format_name` values we trust ffmpeg to
// demux. Observed by running real `ffprobe` against real sample files (see
// task-7b security fix report for the exact commands/output) — not guessed.
// Keys are the literal string ffprobe prints for `-show_entries format=format_name`.
const ALLOWED_FORMATS = new Set([
  'image2',                     // JPEG when ffmpeg recognizes the file's extension
  'jpeg_pipe',                  // the same JPEG content when it doesn't (no/unusual extension, or very small files)
  'png_pipe',                   // PNG
  'webp_pipe',                  // WebP
  'mov,mp4,m4a,3gp,3g2,mj2',    // MP4 / QuickTime .mov family (iPhone video)
  'matroska,webm',              // Matroska / WebM
  'avi',                        // AVI
  'heic',                       // synthetic key, NOT a raw ffprobe format_name -- see
                                 // MOV_FAMILY_FORMAT / isHeicBrand below for why HEIC/HEIF
                                 // can't be allowlisted by format_name like the formats above
]);

// Maps a validated ffprobe format_name to the extension we actually save
// the file under and serve it as — never trust the guest's own filename
// extension for this (see processPhoto.js / server.js for why).
const FORMAT_TO_EXT = {
  image2: 'jpg',
  jpeg_pipe: 'jpg',
  png_pipe: 'png',
  webp_pipe: 'webp',
  heic: 'heic',
};

// ffmpeg demuxes HEIC/HEIF stills with the exact same ISOBMFF "mov" demuxer
// it uses for real MP4/MOV video, so ffprobe's format_name is IDENTICAL for
// both: confirmed against FFmpeg's own source (libavformat/mov.c,
// release/6.1 branch -- the ffmpeg 6.x family Alpine 3.19+ ships), where
// `ff_mov_demuxer.name` is literally the string below, with no separate
// heif/heic token. (An older, non-mainline ffmpeg fork once appended
// ",heif,heic" to this name, but a 2017 ffmpeg-devel patch proposing that for
// mainline was explicitly rejected by a maintainer, so Alpine's ffmpeg does
// not have it.) Because both ALLOWED_FORMATS and VIDEO_FORMAT_TO_EXT already
// key off this exact string for genuine video, detectAndValidateFormat can't
// just add a HEIC format_name to FORMAT_TO_EXT -- that would make the same
// key mean "treat as heic photo" and "treat as mov video" at once, letting a
// guest-mislabeled MP4 (sent with an image/* mimetype) sail through
// processPhoto.js's content check. Instead it's disambiguated below via the
// ftyp box's major_brand/compatible_brands tags (isHeicBrand), and only a
// confirmed HEIC/HEIF brand match gets remapped to the synthetic 'heic' key.
const MOV_FAMILY_FORMAT = 'mov,mp4,m4a,3gp,3g2,mj2';

// ISOBMFF "ftyp" box brand codes that identify real HEIC/HEIF image content.
// Still-image brands (heic/heix/heim/heis, mif1) per IANA's media type
// registrations for image/heic and image/heif:
//   https://www.iana.org/assignments/media-types/image/heic
//   https://www.iana.org/assignments/media-types/image/heif
// Image-SEQUENCE brands (hevc/hevx, msf1) -- e.g. iPhone "Live Photo"-style
// HEIC bursts -- per the MP4 Registration Authority brand registry:
//   https://mp4ra.org/registered-types/brands
// verificado por investigación (registros IANA/MP4RA), no por build real
// contra un .heic de iPhone (sin Docker en este entorno) — confirmar contra
// una imagen real antes de producción.
const HEIC_FAMILY_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'mif1', 'hevc', 'hevx', 'msf1']);

// Pure, synchronous: does this ftyp major_brand/compatible_brands pairing
// identify real HEIC/HEIF content? Split out from detectAndValidateFormat so
// it's unit-testable without spawning ffprobe or needing a real sample file.
function isHeicBrand(majorBrand, compatibleBrands) {
  if (typeof majorBrand === 'string' && HEIC_FAMILY_BRANDS.has(majorBrand)) {
    return true;
  }
  if (typeof compatibleBrands === 'string') {
    // compatible_brands is a run of concatenated 4-byte brand codes with no
    // separator (e.g. "mif1heic") -- split into exact 4-char chunks instead
    // of substring-matching, so a brand code can't false-match across two
    // unrelated brands' byte boundary.
    for (let i = 0; i + 4 <= compatibleBrands.length; i += 4) {
      if (HEIC_FAMILY_BRANDS.has(compatibleBrands.slice(i, i + 4))) {
        return true;
      }
    }
  }
  return false;
}

// Parses the `TAG:key=value` lines ffprobe's default writer prints for
// `-show_entries format_tags=major_brand,compatible_brands`.
function parseFtypBrandTags(stdout) {
  const tags = {};
  for (const line of stdout.split('\n')) {
    const match = /^TAG:(major_brand|compatible_brands)=(.*)$/.exec(line.trim());
    if (match) {
      tags[match[1]] = match[2];
    }
  }
  return tags;
}

// Same idea as FORMAT_TO_EXT but for the video-container formats in
// ALLOWED_FORMATS — video originals are also served statically by nginx
// under their stored extension even though no manifest field links them
// directly, so they need the same stored-XSS protection as photos.
const VIDEO_FORMAT_TO_EXT = {
  'mov,mp4,m4a,3gp,3g2,mj2': 'mov',
  'matroska,webm': 'mkv',
  'avi': 'avi',
};

// Pure, synchronous default-deny check: true only for exact ALLOWED_FORMATS
// members. Anything else (including non-strings) is false. No process spawn.
function isAllowedFormat(formatName) {
  return typeof formatName === 'string' && ALLOWED_FORMATS.has(formatName);
}

// Probes the real, content-sniffed demuxer format of an untrusted file and
// rejects anything not on ALLOWED_FORMATS. This must run BEFORE any other
// ffmpeg/ffprobe call touches an untrusted (guest-uploaded) file, because
// `-protocol_whitelist file` alone does not stop ffmpeg's demuxer
// auto-probing from selecting a dangerous demuxer (e.g. `concat`, which can
// read arbitrary other local files via the already-whitelisted `file`
// protocol even though the "network" protocol trick is blocked).
//
// Returns { key, demuxer } rather than a single string:
//   - `demuxer` is ALWAYS the real, raw ffprobe-reported format_name -- this
//     is the only value that may ever be passed to an ffmpeg/ffprobe `-f`
//     flag (there is no such demuxer as "heic"; ffmpeg still demuxes HEIC
//     content with the real mov-family demuxer, so forcing `-f heic` throws
//     "Unknown input format: 'heic'").
//   - `key` is what callers look up in FORMAT_TO_EXT/VIDEO_FORMAT_TO_EXT for
//     extension/content-type decisions -- the synthetic 'heic' value when an
//     HEIC/HEIF brand was matched, otherwise identical to `demuxer`, so
//     non-HEIC behavior is byte-for-byte unchanged.
async function detectAndValidateFormat(filePath) {
  const { stdout } = await runFfprobe([
    '-v', 'error',
    '-protocol_whitelist', 'file',
    '-show_entries', 'format=format_name',
    '-of', 'csv=p=0',
    filePath
  ]);
  // csv output quotes the field when it contains a comma (e.g. "mov,mp4,...").
  const demuxer = stdout.trim().replace(/^"(.*)"$/, '$1');
  let key = demuxer;

  // format_name alone can't distinguish a HEIC/HEIF photo from a real
  // MP4/MOV video (see MOV_FAMILY_FORMAT above) -- only run the extra brand
  // probe for that one shared format, so every other format, and every real
  // video sharing this demuxer family, is validated exactly as before.
  if (demuxer === MOV_FAMILY_FORMAT) {
    const { stdout: tagStdout } = await runFfprobe([
      '-v', 'error',
      '-protocol_whitelist', 'file',
      '-show_entries', 'format_tags=major_brand,compatible_brands',
      '-of', 'default=noprint_wrappers=1',
      filePath
    ]);
    const { major_brand, compatible_brands } = parseFtypBrandTags(tagStdout);
    if (isHeicBrand(major_brand, compatible_brands)) {
      key = 'heic';
    }
  }

  if (!isAllowedFormat(key)) {
    throw new Error(`rejected upload: unrecognized or disallowed media format "${key}"`);
  }
  return { key, demuxer };
}

module.exports = { runCommand, runFfmpeg, runFfprobe, detectAndValidateFormat, isAllowedFormat, isHeicBrand, parseFtypBrandTags, ALLOWED_FORMATS, FORMAT_TO_EXT, VIDEO_FORMAT_TO_EXT };
