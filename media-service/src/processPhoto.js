const { runFfmpeg, runFfprobe, detectAndValidateFormat, FORMAT_TO_EXT } = require('./ffmpeg');
const paths = require('./paths');

async function processPhoto({ id, ext }) {
  const original = paths.originalPath(id, ext);
  // Validate the real content-sniffed format BEFORE any other ffmpeg/ffprobe
  // call touches this untrusted file, then pin it explicitly on every call
  // below so ffmpeg never re-probes (auto-selects) the demuxer itself.
  const format = await detectAndValidateFormat(original);
  // The extension we save/serve the original under comes from the validated
  // content format, never the guest's filename (a valid image named x.html
  // would otherwise be served as text/html). A video container sent with an
  // image/* mimetype passes the allowlist but has no image extension: reject.
  const safeExt = FORMAT_TO_EXT[format];
  if (!safeExt) {
    throw new Error(`rejected upload: content format "${format}" is not a supported image type`);
  }
  await runFfmpeg([
    '-y', '-protocol_whitelist', 'file', '-f', format, '-i', original,
    '-vf', "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease",
    '-q:v', '3', '-update', '1',
    paths.gridPath(id)
  ]);
  const { stdout } = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    '-protocol_whitelist', 'file', '-f', format, '-i', original
  ]);
  const [width, height] = stdout.split('x').map(Number);
  return { width, height, safeExt };
}

module.exports = { processPhoto };
