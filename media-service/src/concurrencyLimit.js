// Simple FIFO counting semaphore. Caps how many CPU-heavy jobs (ffmpeg
// transcodes) run at once; excess callers queue and wait their turn instead
// of all spawning child processes simultaneously and starving the shared VPS.

function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];

  function acquire() {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  function release() {
    const next = queue.shift();
    if (next) {
      next();
    } else {
      active -= 1;
    }
  }

  async function run(fn) {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    run,
    get active() { return active; },
    get queued() { return queue.length; }
  };
}

module.exports = { createLimiter };
