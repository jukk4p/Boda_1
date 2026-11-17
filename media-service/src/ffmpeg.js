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
]);

// Maps a validated ffprobe format_name to the extension we actually save
// the file under and serve it as — never trust the guest's own filename
// extension for this (see processPhoto.js / server.js for why).
const FORMAT_TO_EXT = {
  image2: 'jpg',
  jpeg_pipe: 'jpg',
  png_pipe: 'png',
  webp_pipe: 'webp',
};

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
async function detectAndValidateFormat(filePath) {
  const { stdout } = await runFfprobe([
    '-v', 'error',
    '-protocol_whitelist', 'file',
    '-show_entries', 'format=format_name',
    '-of', 'csv=p=0',
    filePath
  ]);
  // csv output quotes the field when it contains a comma (e.g. "mov,mp4,...").
  const formatName = stdout.trim().replace(/^"(.*)"$/, '$1');
  if (!isAllowedFormat(formatName)) {
    throw new Error(`rejected upload: unrecognized or disallowed media format "${formatName}"`);
  }
  return formatName;
}

module.exports = { runCommand, runFfmpeg, runFfprobe, detectAndValidateFormat, isAllowedFormat, ALLOWED_FORMATS, FORMAT_TO_EXT, VIDEO_FORMAT_TO_EXT };
