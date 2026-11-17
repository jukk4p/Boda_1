const { runFfmpeg, runFfprobe, detectAndValidateFormat, VIDEO_FORMAT_TO_EXT } = require('./ffmpeg');
const paths = require('./paths');

// Decides remux-vs-recode (mejora D): re-encoding every upload with
// libx264 burns CPU we don't have to spend on a VPS shared with ~10 other
// services when the original is already in the exact format we'd encode
// to. "Already compatible" means: video stream is h264, audio stream (if
// any) is already aac, and the longer side is <= 1920px -- the same
// ceiling the recode path's `-vf scale=...:1920:...` already enforces. If
// every condition holds, `-c:v copy -c:a copy` copies the bitstream
// instead of re-encoding it; otherwise the existing recode path runs
// unchanged.
async function isAlreadyCompatible(original, demuxer) {
  const { stdout } = await runFfprobe([
    '-v', 'error',
    '-show_entries', 'stream=codec_name,codec_type,width,height',
    '-of', 'csv=p=0',
    '-protocol_whitelist', 'file', '-f', demuxer, '-i', original
  ]);
  // ffprobe's csv writer prints fields in its own fixed order
  // (codec_name,codec_type,width,height), NOT the order given to
  // -show_entries -- confirmed against a real h264/aac fixture, which
  // printed "h264,video,640,360" / "aac,audio" (no width/height for audio).
  const streams = stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [codecName, codecType, width, height] = line.split(',');
    return { codecType, codecName, width: Number(width), height: Number(height) };
  });
  const video = streams.find((s) => s.codecType === 'video');
  if (!video || video.codecName !== 'h264') {
    return false;
  }
  const audio = streams.find((s) => s.codecType === 'audio');
  if (audio && audio.codecName !== 'aac') {
    return false;
  }
  return Math.max(video.width, video.height) <= 1920;
}

async function processVideo({ id, ext }) {
  const original = paths.originalPath(id, ext);
  // Validate the real content-sniffed format BEFORE any other ffmpeg/ffprobe
  // call touches this untrusted file, then pin it explicitly on every call
  // below so ffmpeg never re-probes (auto-selects) the demuxer itself.
  const { key, demuxer } = await detectAndValidateFormat(original);
  // The extension we save/serve the original under comes from the validated
  // content format, never the guest's filename — same reasoning as
  // processPhoto.js. An image format sent with a video/* mimetype passes
  // the allowlist but has no video extension: reject.
  const safeExt = VIDEO_FORMAT_TO_EXT[key];
  if (!safeExt) {
    throw new Error(`rejected upload: content format "${key}" is not a supported video type`);
  }
  // `-f` always takes `demuxer`, the real ffprobe-reported format, never
  // `key` -- there is no ffmpeg demuxer named "heic" (see ffmpeg.js's
  // detectAndValidateFormat). A guest-mislabeled HEIC photo sent as video/*
  // still gets rejected above because VIDEO_FORMAT_TO_EXT has no 'heic' entry.
  await runFfmpeg(['-y', '-protocol_whitelist', 'file', '-f', demuxer, '-i', original, '-vframes', '1', '-q:v', '3', '-update', '1', paths.posterPath(id)]);
  const codecArgs = (await isAlreadyCompatible(original, demuxer))
    ? ['-c:v', 'copy', '-c:a', 'copy']
    : [
        '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '23',
        '-vf', "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
        '-c:a', 'aac', '-b:a', '128k'
      ];
  await runFfmpeg([
    '-y', '-protocol_whitelist', 'file', '-f', demuxer, '-i', original,
    ...codecArgs, '-movflags', '+faststart',
    paths.videoPath(id)
  ]);
  const { stdout } = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    '-protocol_whitelist', 'file', '-i', paths.videoPath(id)
  ]);
  const [width, height] = stdout.split('x').map(Number);
  return { width, height, safeExt };
}

module.exports = { processVideo };
