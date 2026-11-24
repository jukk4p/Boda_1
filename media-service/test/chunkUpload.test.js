const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshChunkUpload() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunkupload-test-'));
  process.env.UPLOAD_ROOT = dir;
  delete require.cache[require.resolve('../src/paths')];
  delete require.cache[require.resolve('../src/chunkUpload')];
  return require('../src/chunkUpload');
}

test('writeChunk then assembleIfComplete reassembles the file in chunkIndex order once all chunks arrive', () => {
  const chunkUpload = freshChunkUpload();
  chunkUpload.startOrGetSession('up1', 3, 'video.mp4', 'video/mp4');

  // Written out of order: 2, 0, 1.
  chunkUpload.writeChunk('up1', 2, Buffer.from('CCC'));
  chunkUpload.writeChunk('up1', 0, Buffer.from('AAA'));
  const { complete } = chunkUpload.writeChunk('up1', 1, Buffer.from('BBB'));
  assert.strictEqual(complete, true);

  const assembledPath = chunkUpload.assembleIfComplete('up1');
  assert.ok(assembledPath, 'expected a path to the assembled file');
  assert.strictEqual(fs.readFileSync(assembledPath, 'utf8'), 'AAABBBCCC');
});

test('receivedChunks reports only the chunk indices actually written (for resume)', () => {
  const chunkUpload = freshChunkUpload();
  chunkUpload.startOrGetSession('up2', 4, 'photo.jpg', 'image/jpeg');

  chunkUpload.writeChunk('up2', 0, Buffer.from('A'));
  chunkUpload.writeChunk('up2', 2, Buffer.from('C'));

  assert.deepStrictEqual(chunkUpload.receivedChunks('up2'), [0, 2]);
});

test('assembleIfComplete returns null while chunks are still missing', () => {
  const chunkUpload = freshChunkUpload();
  chunkUpload.startOrGetSession('up3', 3, 'photo.jpg', 'image/jpeg');

  chunkUpload.writeChunk('up3', 0, Buffer.from('A'));
  chunkUpload.writeChunk('up3', 1, Buffer.from('B'));

  assert.strictEqual(chunkUpload.assembleIfComplete('up3'), null);
});

test('writeChunk is idempotent — re-sending an already-received chunk does not duplicate data', () => {
  const chunkUpload = freshChunkUpload();
  chunkUpload.startOrGetSession('up4', 2, 'clip.mp4', 'video/mp4');

  chunkUpload.writeChunk('up4', 0, Buffer.from('AAA'));
  chunkUpload.writeChunk('up4', 0, Buffer.from('AAA')); // resend same chunk
  const { receivedChunks, complete } = chunkUpload.writeChunk('up4', 1, Buffer.from('BBB'));

  assert.deepStrictEqual(receivedChunks, [0, 1]);
  assert.strictEqual(complete, true);

  const assembledPath = chunkUpload.assembleIfComplete('up4');
  assert.strictEqual(fs.readFileSync(assembledPath, 'utf8'), 'AAABBB');
});

test('sweepAbandoned deletes only session directories older than maxAgeMs and returns their ids', () => {
  const chunkUpload = freshChunkUpload();
  chunkUpload.startOrGetSession('old-session', 2, 'a.jpg', 'image/jpeg');
  chunkUpload.startOrGetSession('fresh-session', 2, 'b.jpg', 'image/jpeg');

  const paths = require('../src/paths');
  const oldDir = path.join(paths.UPLOAD_ROOT, 'chunks', 'old-session');
  const oldTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
  fs.utimesSync(oldDir, oldTime, oldTime);

  const removed = chunkUpload.sweepAbandoned(5 * 60 * 1000); // 5 minutes

  assert.deepStrictEqual(removed, ['old-session']);
  assert.strictEqual(fs.existsSync(oldDir), false);
  assert.strictEqual(fs.existsSync(path.join(paths.UPLOAD_ROOT, 'chunks', 'fresh-session')), true);
});

test('a path-traversal uploadId is rejected instead of resolving outside UPLOAD_ROOT/chunks', () => {
  const chunkUpload = freshChunkUpload();
  const paths = require('../src/paths');
  const evilId = '../../evil';

  assert.throws(() => chunkUpload.startOrGetSession(evilId, 1, 'a.jpg', 'image/jpeg'));
  assert.throws(() => chunkUpload.writeChunk(evilId, 0, Buffer.from('A')));
  assert.throws(() => chunkUpload.receivedChunks(evilId));
  assert.throws(() => chunkUpload.assembleIfComplete(evilId));

  // Nothing should have been created above UPLOAD_ROOT.
  assert.strictEqual(fs.existsSync(path.join(paths.UPLOAD_ROOT, '..', '..', 'evil')), false);
  assert.strictEqual(fs.existsSync(path.join(paths.UPLOAD_ROOT, '..', 'evil')), false);
});

test('a non-integer or negative chunkIndex is rejected by writeChunk', () => {
  const chunkUpload = freshChunkUpload();
  chunkUpload.startOrGetSession('up5', 2, 'a.jpg', 'image/jpeg');

  assert.throws(() => chunkUpload.writeChunk('up5', -1, Buffer.from('A')));
  assert.throws(() => chunkUpload.writeChunk('up5', 1.5, Buffer.from('A')));
  assert.throws(() => chunkUpload.writeChunk('up5', '../../evil', Buffer.from('A')));
  assert.throws(() => chunkUpload.writeChunk('up5', NaN, Buffer.from('A')));

  // Nothing should have been written for the rejected calls.
  assert.deepStrictEqual(chunkUpload.receivedChunks('up5'), []);
});

test('getCompletion returns null before markCompleted has been called for this uploadId', () => {
  const chunkUpload = freshChunkUpload();
  assert.strictEqual(chunkUpload.getCompletion('never-completed'), null);
});

test('markCompleted then getCompletion round-trips the completed item id, even after the session dir is gone', () => {
  const chunkUpload = freshChunkUpload();
  chunkUpload.startOrGetSession('up6', 1, 'a.jpg', 'image/jpeg');
  chunkUpload.writeChunk('up6', 0, Buffer.from('A'));
  const assembledPath = chunkUpload.assembleIfComplete('up6');
  assert.ok(assembledPath); // session dir is deleted as a side effect of this

  chunkUpload.markCompleted('up6', 'final-item-id');

  assert.deepStrictEqual(chunkUpload.getCompletion('up6'), { id: 'final-item-id' });
});

test('markCompleted and getCompletion reject a path-traversal uploadId instead of resolving outside UPLOAD_ROOT/chunks', () => {
  const chunkUpload = freshChunkUpload();
  const evilId = '../../evil';

  assert.throws(() => chunkUpload.markCompleted(evilId, 'x'));
  assert.throws(() => chunkUpload.getCompletion(evilId));
});
