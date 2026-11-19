const fs = require('fs');
const path = require('path').posix;
const paths = require('./paths');

const CHUNK_EXT = '.part';
const META_FILE = 'meta.json';

const chunksRoot = () => path.join(paths.UPLOAD_ROOT, 'chunks');
const sessionDir = (uploadId) => path.join(chunksRoot(), uploadId);
const sessionMetaPath = (uploadId) => path.join(sessionDir(uploadId), META_FILE);
const chunkPath = (uploadId, chunkIndex) => path.join(sessionDir(uploadId), `${chunkIndex}${CHUNK_EXT}`);

function readMeta(uploadId) {
  const metaFile = sessionMetaPath(uploadId);
  if (!fs.existsSync(metaFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  } catch {
    return null;
  }
}

// Starts a new chunked-upload session, or returns the existing one unchanged
// if it was already started (so a retried "start" request is a no-op).
function startOrGetSession(uploadId, totalChunks, filename, mimetype) {
  const existing = readMeta(uploadId);
  if (existing) return existing;

  fs.mkdirSync(sessionDir(uploadId), { recursive: true });
  const info = { uploadId, totalChunks, filename, mimetype };
  fs.writeFileSync(sessionMetaPath(uploadId), JSON.stringify(info));
  return info;
}

// Returns the chunk indices actually present on disk for this session, sorted
// ascending, so a client can resume by asking for what's missing.
function receivedChunks(uploadId) {
  const dir = sessionDir(uploadId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(CHUNK_EXT))
    .map((name) => parseInt(name.slice(0, -CHUNK_EXT.length), 10))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

// Writes (or overwrites) one chunk. Re-sending the same chunkIndex just
// replaces that chunk's file in place, so it never duplicates data.
function writeChunk(uploadId, chunkIndex, buffer) {
  fs.mkdirSync(sessionDir(uploadId), { recursive: true });
  fs.writeFileSync(chunkPath(uploadId, chunkIndex), buffer);

  const received = receivedChunks(uploadId);
  const meta = readMeta(uploadId);
  const complete = !!meta && received.length === meta.totalChunks;
  return { receivedChunks: received, complete };
}

// Concatenates chunks 0..totalChunks-1 (numeric order, regardless of the
// order they were written in) into a single file once all of them are
// present, then deletes the session directory. Returns null while chunks
// are still missing.
function assembleIfComplete(uploadId) {
  const meta = readMeta(uploadId);
  if (!meta) return null;

  const received = receivedChunks(uploadId);
  if (received.length !== meta.totalChunks) return null;

  // Assembled file lives next to (not inside) the per-session directory,
  // since that directory is deleted as soon as assembly finishes.
  const outputPath = path.join(chunksRoot(), `${uploadId}-${path.basename(meta.filename)}`);
  const fd = fs.openSync(outputPath, 'w');
  try {
    for (let i = 0; i < meta.totalChunks; i++) {
      fs.writeSync(fd, fs.readFileSync(chunkPath(uploadId, i)));
    }
  } finally {
    fs.closeSync(fd);
  }

  fs.rmSync(sessionDir(uploadId), { recursive: true, force: true });
  return outputPath;
}

// Deletes session directories whose own mtime is older than maxAgeMs (i.e.
// sessions nobody has written a chunk to recently) and returns their ids.
function sweepAbandoned(maxAgeMs) {
  const root = chunksRoot();
  if (!fs.existsSync(root)) return [];

  const now = Date.now();
  const removed = [];
  for (const uploadId of fs.readdirSync(root)) {
    const dir = sessionDir(uploadId);
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) continue;
    if (now - stat.mtimeMs > maxAgeMs) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(uploadId);
    }
  }
  return removed;
}

module.exports = { startOrGetSession, writeChunk, receivedChunks, assembleIfComplete, sweepAbandoned };
