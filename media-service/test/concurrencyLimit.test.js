const { test } = require('node:test');
const assert = require('node:assert');
const { createLimiter } = require('../src/concurrencyLimit');

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('caps concurrent executions at the limit, queues the rest', async () => {
  const limiter = createLimiter(2);
  let concurrent = 0;
  let maxConcurrent = 0;
  const gates = [deferred(), deferred(), deferred(), deferred()];

  const runs = gates.map((gate, i) => limiter.run(async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await gate.promise;
    concurrent -= 1;
    return i;
  }));

  // Let the microtask queue settle so the first batch has started.
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(limiter.active, 2);
  assert.strictEqual(limiter.queued, 2);

  gates[0].resolve();
  gates[1].resolve();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(limiter.active, 2);
  assert.strictEqual(limiter.queued, 0);

  gates[2].resolve();
  gates[3].resolve();
  const results = await Promise.all(runs);

  assert.strictEqual(maxConcurrent, 2);
  assert.deepStrictEqual(results, [0, 1, 2, 3]);
  assert.strictEqual(limiter.active, 0);
});

test('releases the slot even when the job throws, so later jobs still run', async () => {
  const limiter = createLimiter(1);

  await assert.rejects(() => limiter.run(async () => { throw new Error('boom'); }), /boom/);

  let ran = false;
  await limiter.run(async () => { ran = true; });
  assert.strictEqual(ran, true);
  assert.strictEqual(limiter.active, 0);
});
