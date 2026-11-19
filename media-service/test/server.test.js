const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-test-'));
  process.env.UPLOAD_ROOT = dir;
  delete require.cache[require.resolve('../src/paths')];
  delete require.cache[require.resolve('../src/manifest')];
  delete require.cache[require.resolve('../src/server')];
  const { app } = require('../src/server');
  const manifest = require('../src/manifest');
  return { app, manifest };
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
