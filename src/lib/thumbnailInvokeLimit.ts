/**
 * Limits concurrent `get_thumbnail` IPC calls when batch prefetch did not fill the cache.
 * At max decode size, unbounded parallelism can saturate the Rust side and stutter the UI.
 */
const MAX_CONCURRENT = 8;
let active = 0;
const waitQueue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waitQueue.push(() => {
      active += 1;
      resolve();
    });
  });
}

function release() {
  active -= 1;
  const next = waitQueue.shift();
  if (next) next();
}

export async function withThumbnailInvokeLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
