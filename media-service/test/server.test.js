const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCommand } = require('../src/ffmpeg');

function freshApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-test-'));
  process.env.UPLOAD_ROOT = dir;
  delete require.cache[require.resolve('../src/paths')];
  delete require.cache[require.resolve('../src/manifest')];
  delete require.cache[require.resolve('../src/chunkUpload')];
  // processPhoto/processVideo each capture `./paths` (and its UPLOAD_ROOT)
  // at their own first require and hold onto it for the life of the
  // process; without clearing them too, a test that actually drives the
  // real image/video pipeline after an earlier freshApp() call picks up a
  // stale, previous test's UPLOAD_ROOT instead of this one's fresh dir.
  delete require.cache[require.resolve('../src/processPhoto')];
  delete require.cache[require.resolve('../src/processVideo')];
  delete require.cache[require.resolve('../src/server')];
  const { app } = require('../src/server');
  const manifest = require('../src/manifest');
  return { app, manifest };
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

// A tiny, real JPEG (not a mock/fixture stub) so the full detect/processPhoto
// pipeline (ffprobe content-sniffing, ffmpeg grid resize) runs for real.
function makeJpegFixture(dir) {
  const outPath = path.join(dir, 'fixture.jpg');
  return runCommand('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32',
    '-frames:v', '1', outPath
  ]).then(() => outPath);
}

function uploadIdFor(label) {
  return `test-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function postChunk(baseUrl, { uploadId, chunkIndex, totalChunks, filename, mimetype, buffer }) {
  const form = new FormData();
  form.append('uploadId', uploadId);
  form.append('chunkIndex', String(chunkIndex));
  form.append('totalChunks', String(totalChunks));
  form.append('filename', filename);
  form.append('mimetype', mimetype);
  form.append('chunk', new Blob([buffer]), `${chunkIndex}.part`);
  return fetch(`${baseUrl}/upload/chunk`, { method: 'POST', body: form });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

test('GET /unbacked lists only items without backedUpAt, with their originalExt', async () => {
  const { app, manifest } = freshApp();
  manifest.appendLine({ id: '1_a', originalExt: 'jpg', backedUpAt: 1732000000000 });
  manifest.appendLine({ id: '2_b', originalExt: 'mp4' }); // backedUpAt ausente
  const server = await listen(app);
  try {
    const res = await fetch(`${baseUrl(server)}/unbacked`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), [{ id: '2_b', originalExt: 'mp4' }]);
  } finally {
    server.close();
  }
});

test('POST /backed/:id marks the item and GET /unbacked stops listing it', async () => {
  const { app, manifest } = freshApp();
  manifest.appendLine({ id: '1_a', originalExt: 'jpg', backedUpAt: null });
  const server = await listen(app);
  try {
    const postRes = await fetch(`${baseUrl(server)}/backed/1_a`, { method: 'POST' });
    assert.strictEqual(postRes.status, 200);
    const body = await postRes.json();
    assert.strictEqual(body.id, '1_a');
    assert.strictEqual(typeof body.backedUpAt, 'number');

    const listRes = await fetch(`${baseUrl(server)}/unbacked`);
    assert.deepStrictEqual(await listRes.json(), []);
  } finally {
    server.close();
  }
});

test('POST /backed/:id returns 404 for an unknown id', async () => {
  const { app } = freshApp();
  const server = await listen(app);
  try {
    const res = await fetch(`${baseUrl(server)}/backed/missing`, { method: 'POST' });
    assert.strictEqual(res.status, 404);
  } finally {
    server.close();
  }
});

test('POST /upload/chunk assembles and processes the file once the last chunk arrives', async (t) => {
  if (!(await ffmpegToolsAvailable())) {
    t.skip('ffmpeg/ffprobe not found on PATH in this environment');
    return;
  }
  const { app, manifest } = freshApp();
  const server = await listen(app);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-chunk-fixture-'));
  try {
    const fixturePath = await makeJpegFixture(workDir);
    const bytes = fs.readFileSync(fixturePath);
    const mid = Math.ceil(bytes.length / 2);
    const chunk0 = bytes.subarray(0, mid);
    const chunk1 = bytes.subarray(mid);
    const uploadId = uploadIdFor('assemble');

    const res0 = await postChunk(baseUrl(server), {
      uploadId, chunkIndex: 0, totalChunks: 2, filename: 'fixture.jpg', mimetype: 'image/jpeg', buffer: chunk0
    });
    assert.strictEqual(res0.status, 202);
    assert.deepStrictEqual(await res0.json(), { uploadId, receivedChunks: [0] });

    const res1 = await postChunk(baseUrl(server), {
      uploadId, chunkIndex: 1, totalChunks: 2, filename: 'fixture.jpg', mimetype: 'image/jpeg', buffer: chunk1
    });
    // Last chunk: same response shape POST /upload gives today.
    assert.strictEqual(res1.status, 202);
    const body1 = await res1.json();
    assert.strictEqual(typeof body1.id, 'string');
    assert.strictEqual(body1.status, 'processing');

    // Processing runs in the background; poll /list until the item shows up
    // (or time out), then verify it has the same shape POST /upload produces.
    let item;
    for (let i = 0; i < 50 && !item; i++) {
      const items = manifest.readAll();
      item = items.find((it) => it.id === body1.id);
      if (!item) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(item, 'expected the assembled upload to appear in the manifest');
    assert.strictEqual(typeof item.url, 'string');
    assert.strictEqual(typeof item.gridUrl, 'string');
    assert.strictEqual(item.originalExt, 'jpg');
    assert.strictEqual(item.backedUpAt, null);

    const listRes = await fetch(`${baseUrl(server)}/list`);
    const listBody = await listRes.json();
    assert.ok(listBody.some((it) => it.id === body1.id));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    server.close();
  }
});

test('GET /upload/chunk/:uploadId/status reflects partial progress for resume', async () => {
  const { app } = freshApp();
  const server = await listen(app);
  try {
    const uploadId = uploadIdFor('status');
    const res0 = await postChunk(baseUrl(server), {
      uploadId, chunkIndex: 0, totalChunks: 3, filename: 'clip.mp4', mimetype: 'video/mp4', buffer: Buffer.from('AAA')
    });
    assert.strictEqual(res0.status, 202);
    assert.deepStrictEqual(await res0.json(), { uploadId, receivedChunks: [0] });

    const statusRes = await fetch(`${baseUrl(server)}/upload/chunk/${uploadId}/status`);
    assert.strictEqual(statusRes.status, 200);
    assert.deepStrictEqual(await statusRes.json(), { receivedChunks: [0] });
  } finally {
    server.close();
  }
});

test('GET /upload/chunk/:uploadId/status for an unknown/never-started uploadId reports no chunks received', async () => {
  const { app } = freshApp();
  const server = await listen(app);
  try {
    const statusRes = await fetch(`${baseUrl(server)}/upload/chunk/${uploadIdFor('unknown')}/status`);
    assert.strictEqual(statusRes.status, 200);
    assert.deepStrictEqual(await statusRes.json(), { receivedChunks: [] });
  } finally {
    server.close();
  }
});

test('POST /upload/chunk rejects a path-traversal uploadId as a client error instead of crashing', async () => {
  const { app } = freshApp();
  const server = await listen(app);
  try {
    const res = await postChunk(baseUrl(server), {
      uploadId: '../../evil', chunkIndex: 0, totalChunks: 1, filename: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('A')
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /upload/chunk rejects a malformed/gapped chunk set (assembleIfComplete ENOENT) as a 4xx, not a crash', async () => {
  const { app } = freshApp();
  const server = await listen(app);
  try {
    const uploadId = uploadIdFor('gapped');
    // Claims 3 total chunks but sends indices 0, 1, 5 -- received.length (3)
    // matches meta.totalChunks (3), so assembleIfComplete attempts assembly
    // and throws ENOENT reading the (never-written) index-2 chunk file.
    await postChunk(baseUrl(server), {
      uploadId, chunkIndex: 0, totalChunks: 3, filename: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('A')
    });
    await postChunk(baseUrl(server), {
      uploadId, chunkIndex: 1, totalChunks: 3, filename: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('B')
    });
    const res = await postChunk(baseUrl(server), {
      uploadId, chunkIndex: 5, totalChunks: 3, filename: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('C')
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /upload/chunk rejects a chunk over the per-chunk size cap (20MB) instead of buffering it into memory', async () => {
  const { app } = freshApp();
  const server = await listen(app);
  try {
    // One byte over server.js's CHUNK_MAX_BYTES (20MB) -- content doesn't
    // matter, multer's fileSize limit rejects it before the route handler
    // (or chunkUpload.js) ever sees it.
    const oversizedChunk = Buffer.alloc(20 * 1024 * 1024 + 1);
    const res = await postChunk(baseUrl(server), {
      uploadId: uploadIdFor('oversized'), chunkIndex: 0, totalChunks: 1,
      filename: 'big.jpg', mimetype: 'image/jpeg', buffer: oversizedChunk
    });
    // Same LIMIT_FILE_SIZE -> 413 handling POST /upload already gets from
    // the shared error-handling middleware at the bottom of server.js.
    assert.strictEqual(res.status, 413);
  } finally {
    server.close();
  }
});
