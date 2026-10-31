import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * `lib/api.ts` binds `globalThis.fetch` when it is first imported, so a test
 * cannot swap fetch afterwards. Install one stable function here and let the
 * tests point it at a fake server through the bridge.
 */
export type FetchBridge = { handler: typeof fetch | null };

const bridge: FetchBridge = { handler: null };

Object.defineProperty(globalThis, '__airtimeFetchBridge', {
  value: bridge,
  configurable: true,
});

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (!bridge.handler) {
    return Promise.reject(new TypeError('no fake server installed'));
  }
  return bridge.handler(input, init);
}) as typeof fetch;

// React Testing Library only registers its own cleanup when test globals are
// enabled; the project keeps globals off, so unmount between tests here.
afterEach(async () => {
  cleanup();
  // Let native calls still in flight from the unmounted provider land before
  // the stores are wiped, or they would write into the next test's storage.
  await new Promise((resolve) => setTimeout(resolve, 40));
  bridge.handler = null;
  window.localStorage.clear();
});

// In the Tauri app every native call is an asynchronous IPC round trip. The
// browser fallbacks resolve in a microtask, which is faster than React can
// commit state, so give each call a few milliseconds of latency like the real thing.
vi.mock('../lib/native', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/native')>();
  const slow =
    <Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return fn(...args);
    };
  return {
    ...original,
    saveSecret: slow(original.saveSecret),
    loadSecret: slow(original.loadSecret),
    deleteSecret: slow(original.deleteSecret),
    readCacheFile: slow(original.readCacheFile),
    writeCacheFile: slow(original.writeCacheFile),
  };
});
