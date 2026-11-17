const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCommand } = require('../src/ffmpeg');

// --- test infrastructure -----------------------------------------------
//
// processVideo.js destructures `runFfmpeg` out of `./ffmpeg` at require
// time:
//   const { runFfmpeg, ... } = require('./ffmpeg');
// so to observe which ffmpeg invocation processVideo actually made (copy
// vs re-encode flags) without faking ffmpeg itself, we mutate the *real*
// ffmpeg module's `runFfmpeg` export in place (adding a call-recording
// wrapper that still calls straight through to the real spawn), then clear
// processVideo's require cache so its top-level destructuring picks up the
// wrapped function on next require. Real ffmpeg still runs for every call;
// we're only recording the argv each call used. This is the "spy/flag"
// approach the task brief suggests, and it's the only way to see the
// decision processVideo made without re-deriving it by re-probing the
// output file in a second, independent way for every assertion.
const ffmpegModule = require('../src/ffmpeg');
const realRunFfmpeg = ffmpegModule.runFfmpeg;

function installFfmpegSpy() {
  const calls = [];
  ffmpegModule.runFfmpeg = (args) => {
    calls.push(args);
    return realRunFfmpeg(args);
  };
  return calls;
}

function restoreFfmpeg() {
  ffmpegModule.runFfmpeg = realRunFfmpeg;
}

function freshProcessVideo(dir) {
  process.env.UPLOAD_ROOT = dir;
  delete require.cache[require.resolve('../src/paths')];
  delete require.cache[require.resolve('../src/processVideo')];
  const paths = require('../src/paths');
  const { processVideo } = require('../src/processVideo');
  return { paths, processVideo };
}

async function ffmpegToolsAvailable() {
  try {
    await runCommand('ffprobe', ['-version']);
    await runCommand('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

function makeFixture(dir, name, encodeArgs) {
  const outPath = path.join(dir, name);
  return runCommand('ffmpeg', ['-y', '-v', 'error', ...encodeArgs, outPath]).then(() => outPath);
}

// h264 video + aac audio, 640x360 -- well under the 1920px ceiling and
// already in the exact codecs processVideo re-encodes TO, so it should
// qualify for stream copy.
function makeCompatibleFixture(dir) {
  return makeFixture(dir, 'compatible.mp4', [
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:duration=1:rate=25',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '1', '-shortest'
  ]);
}

// Same resolution (well under 1920px) but a different video codec (mpeg4
// instead of h264) -- fails the "already h264" half of the criterion, so
// it must take the re-encode path.
function makeIncompatibleCodecFixture(dir) {
  return makeFixture(dir, 'incompatible-codec.mp4', [
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:duration=1:rate=25',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-c:v', 'mpeg4', '-c:a', 'aac', '-t', '1', '-shortest'
  ]);
}

function makeDirsFor(paths, id, ext) {
  fs.mkdirSync(path.dirname(paths.originalPath(id, ext)), { recursive: true });
  fs.mkdirSync(path.dirname(paths.posterPath(id)), { recursive: true });
  fs.mkdirSync(path.dirname(paths.videoPath(id)), { recursive: true });
}

function transcodeCallArgs(calls) {
  // The poster-frame call always has '-vframes'; the transcode call never
  // does. There are always exactly two runFfmpeg calls.
  return calls.find((args) => !args.includes('-vframes'));
}

// --- tests ---------------------------------------------------------------

test('processVideo copies the stream instead of re-encoding when already h264/aac within 1920px', async (t) => {
  if (!(await ffmpegToolsAvailable())) {
    t.skip('ffmpeg/ffprobe not found on PATH in this environment');
    return;
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'processVideo-test-'));
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'processVideo-upload-'));
  const calls = installFfmpegSpy();
  try {
    const fixturePath = await makeCompatibleFixture(workDir);
    const { paths, processVideo } = freshProcessVideo(uploadDir);
    const id = 'compat-fixture';
    const ext = 'mp4';
    makeDirsFor(paths, id, ext);
    fs.copyFileSync(fixturePath, paths.originalPath(id, ext));

    const result = await processVideo({ id, ext });

    // Observable signal #1 (the decision itself): the transcode runFfmpeg
    // call used '-c:v copy' / '-c:a copy', never '-crf' or '-vf scale=...'.
    const transcodeArgs = transcodeCallArgs(calls);
    assert.ok(transcodeArgs, 'expected a transcode runFfmpeg call');
    assert.ok(transcodeArgs.includes('copy'), `expected a copy codec arg, got: ${transcodeArgs.join(' ')}`);
    assert.ok(!transcodeArgs.includes('-crf'), `expected no -crf (recode flag) on the copy path, got: ${transcodeArgs.join(' ')}`);
    assert.ok(!transcodeArgs.includes('libx264'), `expected no libx264 (recode flag) on the copy path, got: ${transcodeArgs.join(' ')}`);

    // Observable signal #2 (end result, via real ffprobe on the real
    // output file): both outputs exist, and the final video is still h264
    // (true on both paths -- copy preserves it, recode re-targets it).
    assert.ok(fs.existsSync(paths.posterPath(id)));
    assert.ok(fs.existsSync(paths.videoPath(id)));
    const { stdout } = await runCommand('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'csv=p=0',
      paths.videoPath(id)
    ]);
    assert.strictEqual(stdout.trim(), 'h264');
    assert.strictEqual(result.safeExt, 'mov');
  } finally {
    restoreFfmpeg();
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

test('processVideo re-encodes when the original uses a different codec than h264', async (t) => {
  if (!(await ffmpegToolsAvailable())) {
    t.skip('ffmpeg/ffprobe not found on PATH in this environment');
    return;
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'processVideo-test-'));
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'processVideo-upload-'));
  const calls = installFfmpegSpy();
  try {
    const fixturePath = await makeIncompatibleCodecFixture(workDir);
    const { paths, processVideo } = freshProcessVideo(uploadDir);
    const id = 'incompat-fixture';
    const ext = 'mp4';
    makeDirsFor(paths, id, ext);
    fs.copyFileSync(fixturePath, paths.originalPath(id, ext));

    await processVideo({ id, ext });

    // The transcode call took the re-encode branch: libx264/-crf present,
    // no stream copy.
    const transcodeArgs = transcodeCallArgs(calls);
    assert.ok(transcodeArgs, 'expected a transcode runFfmpeg call');
    assert.ok(transcodeArgs.includes('libx264'), `expected libx264 (recode flag), got: ${transcodeArgs.join(' ')}`);
    assert.ok(transcodeArgs.includes('-crf'), `expected -crf (recode flag), got: ${transcodeArgs.join(' ')}`);
    assert.ok(!transcodeArgs.includes('copy'), `expected no copy codec arg on the recode path, got: ${transcodeArgs.join(' ')}`);

    // Output is still always h264 regardless of which path was taken.
    const { stdout } = await runCommand('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'csv=p=0',
      paths.videoPath(id)
    ]);
    assert.strictEqual(stdout.trim(), 'h264');
  } finally {
    restoreFfmpeg();
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

test('processVideo re-encodes when the original exceeds the 1920px ceiling even if already h264/aac', async (t) => {
  if (!(await ffmpegToolsAvailable())) {
    t.skip('ffmpeg/ffprobe not found on PATH in this environment');
    return;
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'processVideo-test-'));
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'processVideo-upload-'));
  const calls = installFfmpegSpy();
  try {
    const fixturePath = await makeFixture(workDir, 'large.mp4', [
      '-f', 'lavfi', '-i', 'testsrc=size=2560x1440:duration=1:rate=25',
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-t', '1'
    ]);
    const { paths, processVideo } = freshProcessVideo(uploadDir);
    const id = 'large-fixture';
    const ext = 'mp4';
    makeDirsFor(paths, id, ext);
    fs.copyFileSync(fixturePath, paths.originalPath(id, ext));

    await processVideo({ id, ext });

    const transcodeArgs = transcodeCallArgs(calls);
    assert.ok(transcodeArgs, 'expected a transcode runFfmpeg call');
    assert.ok(transcodeArgs.includes('libx264'), `expected libx264 (recode flag) because the source exceeds 1920px, got: ${transcodeArgs.join(' ')}`);
    assert.ok(!transcodeArgs.includes('copy'), `expected no copy codec arg when the source exceeds 1920px, got: ${transcodeArgs.join(' ')}`);
  } finally {
    restoreFfmpeg();
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});
