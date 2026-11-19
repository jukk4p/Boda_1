const express = require('express');
const multer = require('multer');
const fs = require('fs');
const nodePath = require('path');
const { generateId, sanitizeExt } = require('./id');
const paths = require('./paths');
const { processPhoto } = require('./processPhoto');
const { processVideo } = require('./processVideo');
const manifest = require('./manifest');
const { createLimiter } = require('./concurrencyLimit');
const chunkUpload = require('./chunkUpload');

const originalsDir = nodePath.dirname(paths.originalPath('x', 'x'));

// Caps simultaneous ffmpeg transcodes so a burst of guest uploads can't all
// spawn child processes at once and starve the shared VPS (n8n, Postgres,
// ~10 other services). Excess requests queue in-process and still complete,
// just one after another instead of all competing for CPU together.
const MAX_CONCURRENT_PROCESSING = Number(process.env.MAX_CONCURRENT_PROCESSING) || 2;
const processingLimiter = createLimiter(MAX_CONCURRENT_PROCESSING);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(originalsDir, { recursive: true });
      cb(null, originalsDir);
    },
    filename: (req, file, cb) => {
      const id = generateId();
      const ext = sanitizeExt(file.originalname);
      req.uploadId = id;
      req.uploadExt = ext;
      cb(null, `${id}.${ext}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://bodadaniyirene.ivangonzalez.cloud/uploads';

// memoryStorage buffers the whole "chunk" into RAM before the route handler
// even runs (unlike /upload's diskStorage, which streams to disk). Reusing
// the 500MB whole-file limit here would let a single request -- e.g. a
// client that sends totalChunks: 1, legitimate or not -- load up to 500MB
// into process memory, with nothing else throttling concurrent incoming
// requests (MAX_CONCURRENT_PROCESSING only limits ffmpeg work, not multer
// buffering). The chunking client (Task 9) splits files into 5MB pieces;
// 20MB gives generous headroom above that while keeping worst-case RAM use
// per request an order of magnitude below the old 500MB ceiling, on a
// shared VPS running ~10 other services.
const CHUNK_MAX_BYTES = 20 * 1024 * 1024;
const chunkMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHUNK_MAX_BYTES }
});

const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Shared by POST /upload (single-shot) and the final chunk of POST
// /upload/chunk (resumable): both reach this once the raw file already sits
// at paths.originalPath(id, ext) on disk. It sends the 202 ack immediately
// and runs detect/processPhoto-or-processVideo/manifest.appendLine in the
// background, exactly as POST /upload always has.
function runUploadPipeline({ id, ext, originalname, mimetype, res }) {
  const isImage = mimetype.startsWith('image/');
  const isVideo = mimetype.startsWith('video/');
  if (!isImage && !isVideo) {
    try { fs.unlinkSync(paths.originalPath(id, ext)); } catch {}
    return res.status(400).json({ error: 'unsupported mimeType' });
  }

  // Ack as soon as the file is durably on disk, before queueing/transcoding.
  // Under a burst of simultaneous guest uploads, waiting for the processing
  // queue + ffmpeg before responding could outlast the client's own fetch
  // timeout even though the upload itself already succeeded. Processing now
  // continues in the background; the gallery picks each item up once
  // manifest.appendLine runs below (next poll).
  res.status(202).json({ id, status: 'processing' });

  (async () => {
    let safeExt;
    try {
      [paths.gridPath(id), paths.posterPath(id), paths.videoPath(id)]
        .forEach((p) => fs.mkdirSync(nodePath.dirname(p), { recursive: true }));

      let item;
      await processingLimiter.run(async () => {
        if (isImage) {
          const photo = await processPhoto({ id, ext });
          const { width, height } = photo;
          safeExt = photo.safeExt;
          // Serve the original under the extension of its validated content
          // format, never the guest-supplied one (stored-XSS via e.g. x.html).
          if (safeExt !== ext) {
            fs.renameSync(paths.originalPath(id, ext), paths.originalPath(id, safeExt));
          }
          item = {
            id, name: originalname, mimeType: mimetype, width, height,
            url: `${PUBLIC_BASE_URL}/originals/${id}.${safeExt}`,
            gridUrl: `${PUBLIC_BASE_URL}/grid/${id}.jpg`,
            originalExt: safeExt, backedUpAt: null
          };
        } else {
          const video = await processVideo({ id, ext });
          const { width, height } = video;
          safeExt = video.safeExt;
          if (safeExt !== ext) {
            fs.renameSync(paths.originalPath(id, ext), paths.originalPath(id, safeExt));
          }
          item = {
            id, name: originalname, mimeType: 'video/mp4', width, height,
            url: `${PUBLIC_BASE_URL}/video/${id}.mp4`,
            posterUrl: `${PUBLIC_BASE_URL}/posters/${id}.jpg`,
            originalExt: safeExt, backedUpAt: null
          };
        }
      });
      manifest.appendLine(item);
    } catch (err) {
      const cleanup = [paths.originalPath(id, ext), paths.gridPath(id), paths.posterPath(id), paths.videoPath(id)];
      if (safeExt) cleanup.push(paths.originalPath(id, safeExt));
      cleanup.forEach((p) => { try { fs.unlinkSync(p); } catch {} });
      console.error('upload processing failed:', err);
    }
  })();
}

app.post('/upload', upload.single('data'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing file field "data"' });
  runUploadPipeline({
    id: req.uploadId, ext: req.uploadExt,
    originalname: req.file.originalname, mimetype: req.file.mimetype, res
  });
});

app.post('/upload/chunk', chunkMiddleware.single('chunk'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing file field "chunk"' });
  const { uploadId, filename, mimetype } = req.body;
  const chunkIndex = parseInt(req.body.chunkIndex, 10);
  const totalChunks = parseInt(req.body.totalChunks, 10);

  let assembledPath;
  try {
    // A retried final chunk (its 202 ack lost in transit, exactly what the
    // client's own retry/backoff is built to survive) would otherwise find
    // sessionDir(uploadId) already gone -- assembleIfComplete deletes it --
    // and startOrGetSession would silently start a new, broken one-chunk
    // session that can never complete. Short-circuit on the tombstone
    // first: any chunk (any index) arriving for an already-finished
    // uploadId gets the same completion response, without touching the
    // chunk's bytes or any session state.
    const completed = chunkUpload.getCompletion(uploadId);
    if (completed) {
      return res.status(202).json({ id: completed.id, status: 'processing' });
    }

    chunkUpload.startOrGetSession(uploadId, totalChunks, filename, mimetype);
    const { receivedChunks } = chunkUpload.writeChunk(uploadId, chunkIndex, req.file.buffer);
    assembledPath = chunkUpload.assembleIfComplete(uploadId);
    if (!assembledPath) {
      return res.status(202).json({ uploadId, receivedChunks });
    }
  } catch (err) {
    // Covers chunkUpload.js's guard throws (invalid uploadId/chunkIndex) and
    // the known malformed/gapped-chunk-set case where assembleIfComplete can
    // throw ENOENT instead of returning null (e.g. totalChunks claims 3 but
    // the actual indices received are 0, 1, 5) -- a bad request, not a crash.
    console.error('chunk upload failed:', err);
    return res.status(400).json({ error: 'invalid chunk upload request' });
  }

  // Move the assembled file into the same place multer's diskStorage would
  // have put a single-shot upload, so runUploadPipeline can't tell the
  // difference between the two paths.
  const id = generateId();
  const ext = sanitizeExt(filename);
  const destPath = paths.originalPath(id, ext);
  fs.mkdirSync(nodePath.dirname(destPath), { recursive: true });
  fs.renameSync(assembledPath, destPath);

  // Written before any possible retry of this same final chunk could
  // arrive, so that retry hits the tombstone short-circuit above instead
  // of starting a new session.
  chunkUpload.markCompleted(uploadId, id);

  runUploadPipeline({ id, ext, originalname: filename, mimetype, res });
});

app.get('/upload/chunk/:uploadId/status', (req, res) => {
  const { uploadId } = req.params;
  try {
    const completed = chunkUpload.getCompletion(uploadId);
    if (completed) {
      return res.json({ receivedChunks: [], completed: true, id: completed.id });
    }
    res.json({ receivedChunks: chunkUpload.receivedChunks(uploadId) });
  } catch (err) {
    res.status(400).json({ error: 'invalid uploadId' });
  }
});

app.get('/list', (req, res) => res.json(manifest.readAll()));

app.get('/unbacked', (req, res) => {
  const items = manifest.readAll()
    .filter((item) => !item.backedUpAt)
    .map(({ id, originalExt }) => ({ id, originalExt }));
  res.json(items);
});

app.post('/backed/:id', (req, res) => {
  const { id } = req.params;
  const updated = manifest.updateById(id, { backedUpAt: Date.now() });
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json({ id: updated.id, backedUpAt: updated.backedUpAt });
});

app.delete('/items/:id', (req, res) => {
  const { id } = req.params;
  if (!/^\d+_[0-9a-f]{32}$/.test(id)) return res.status(400).json({ error: 'invalid id' });

  const removed = manifest.removeById(id);
  if (!removed) return res.status(404).json({ error: 'not found' });

  const ext = (removed.url || '').split('.').pop();
  const candidates = [paths.gridPath(id), paths.posterPath(id), paths.videoPath(id)];
  if (ext) candidates.push(paths.originalPath(id, ext));
  candidates.forEach((p) => { try { fs.unlinkSync(p); } catch {} });

  res.json({ id, status: 'deleted' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file too large (max 500MB)' });
  }
  console.error('unhandled error:', err);
  res.status(500).json({ error: 'internal server error' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`media-service listening on ${port}`));

  // Deletes chunked-upload sessions nobody finished (client crashed/closed
  // the tab mid-upload) so they don't pile up under UPLOAD_ROOT/chunks forever.
  const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
  const ABANDONED_MAX_AGE_MS = 48 * 3600 * 1000; // 48h
  setInterval(() => {
    try {
      chunkUpload.sweepAbandoned(ABANDONED_MAX_AGE_MS);
    } catch (err) {
      console.error('chunk sweep failed:', err);
    }
  }, SWEEP_INTERVAL_MS);
}

module.exports = { app };
