import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadOnceOnChunkLoadFailure } from './chunk-reload';
import { runOptionalLoad, runSpeculative, setNavigationPending } from './document-recovery';

const chunkError = (file = 'editor-OLD.js') => new TypeError(`Failed to fetch dynamically imported module: https://app.nibleaf.test/assets/${file}`);

/** One browser document. A reload is a new document that keeps the same session storage. */
function fakeWindow(storage: () => Storage) {
  const target = new EventTarget();
  const reload = vi.fn();
  const addEventListener = vi.spyOn(target, 'addEventListener');
  Object.defineProperty(target, 'sessionStorage', { get: storage });
  Object.defineProperty(target, 'location', { value: { pathname: '/app/projects/p1', reload } });
  return { target, reload, addEventListener };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

/** What Vite's preload helper does when a dynamic import fails: dispatch the
 *  event, then rethrow to the importer (the router) unless it was cancelled. */
function dispatchChunkError(error: Error) {
  const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: error });
  window.dispatchEvent(event);
  return event;
}
function failChunkLoad(error: Error) {
  const event = dispatchChunkError(error);
  if (!event.defaultPrevented) throw error;
}

/** Each importer handles the same rejected CSS preload with its own Vite event. */
function importWithCssPreload(preload: Promise<void>) {
  return preload.catch((error: Error) => failChunkLoad(error));
}

/** Load a fresh document on the same session storage and register the handler there. */
function openDocument(storage: Storage) {
  const page = fakeWindow(() => storage);
  vi.stubGlobal('window', page.target);
  reloadOnceOnChunkLoadFailure();
  return page;
}

describe('reload once after a chunk fails to load', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('registers one listener and reloads the page the first time a chunk fails', () => {
    const storage = memoryStorage();
    const page = openDocument(storage);
    reloadOnceOnChunkLoadFailure();

    const calls = page.addEventListener.mock.calls;
    expect(calls.every(([type]) => type === 'vite:preloadError')).toBe(true);
    expect(new Set(calls.map(([, listener]) => listener)).size).toBe(1);
    expect(() => failChunkLoad(chunkError())).toThrow();
    vi.runOnlyPendingTimers();
    expect(page.reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads twice for the same failing chunk, however long the reloaded page takes to fail', () => {
    const storage = memoryStorage();
    const first = openDocument(storage);
    expect(() => failChunkLoad(chunkError())).toThrow();
    vi.runOnlyPendingTimers();
    expect(first.reload).toHaveBeenCalledTimes(1);

    // Each reloaded document fails on the same chunk more than 30 seconds later.
    for (let documents = 0; documents < 4; documents++) {
      vi.advanceTimersByTime(31_000);
      const next = openDocument(storage);
      const repeat = chunkError();
      // The error reaches the router, which renders the route's error component.
      expect(() => failChunkLoad(repeat)).toThrow(repeat);
      vi.runOnlyPendingTimers();
      expect(next.reload).not.toHaveBeenCalled();
    }
  });

  it('reloads again for a different chunk, but never more than twice in a session', () => {
    const storage = memoryStorage();
    const first = openDocument(storage);
    expect(() => failChunkLoad(chunkError('editor-OLD.js'))).toThrow();
    vi.runOnlyPendingTimers();
    const second = openDocument(storage);
    expect(() => failChunkLoad(chunkError('settings-OLD.js'))).toThrow();
    vi.runOnlyPendingTimers();
    const third = openDocument(storage);
    expect(() => failChunkLoad(chunkError('analytics-OLD.js'))).toThrow();
    vi.runOnlyPendingTimers();

    expect(first.reload).toHaveBeenCalledTimes(1);
    expect(second.reload).toHaveBeenCalledTimes(1);
    expect(third.reload).not.toHaveBeenCalled();
  });

  it('counts one reload per document when several chunks fail before it happens', () => {
    const storage = memoryStorage();
    const first = openDocument(storage);
    expect(() => failChunkLoad(chunkError('editor-OLD.js'))).toThrow();
    expect(() => failChunkLoad(chunkError('editor-OLD.css'))).toThrow();
    vi.runOnlyPendingTimers();
    expect(first.reload).toHaveBeenCalledTimes(1);

    // The second slot is still free for a later failure on the reloaded page.
    const second = openDocument(storage);
    expect(() => failChunkLoad(chunkError('settings-OLD.js'))).toThrow();
    vi.runOnlyPendingTimers();
    expect(second.reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads the page being read when only a prefetch failed to load a chunk', async () => {
    const storage = memoryStorage();
    const page = openDocument(storage);
    let finish: () => void = () => undefined;
    const prefetch = runSpeculative(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    // Cancelled, so Vite doesn't rethrow into a prefetch nobody awaits.
    expect(() => failChunkLoad(chunkError('next-page-OLD.js'))).not.toThrow();
    vi.runOnlyPendingTimers();
    expect(page.reload).not.toHaveBeenCalled();

    // Once the reader opens a page, a chunk failure is theirs and reloads.
    setNavigationPending(true);
    expect(() => failChunkLoad(chunkError('next-page-OLD.js'))).toThrow();
    vi.runOnlyPendingTimers();
    expect(page.reload).toHaveBeenCalledTimes(1);
    setNavigationPending(false);
    finish();
    await prefetch;
  });

  it('never reloads the page for a load it can do without (runOptionalLoad)', async () => {
    const page = openDocument(memoryStorage());
    const error = chunkError('picker-OLD.js');
    // Vite dispatches the event, then rethrows the same error to the importer.
    const optional = runOptionalLoad(async () => {
      failChunkLoad(error);
    });
    await expect(optional).rejects.toBe(error);
    vi.runOnlyPendingTimers();
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('never reloads for an optional rejected CSS preload dispatched before the importer catches it', async () => {
    const page = openDocument(memoryStorage());
    const error = new Error('Unable to preload CSS for /assets/picker-OLD.css');
    const optional = runOptionalLoad(() => importWithCssPreload(Promise.reject(error)));
    await expect(optional).rejects.toBe(error);
    expect(page.reload).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('discards a delayed optional catch so a later event with the same error still recovers', async () => {
    vi.stubEnv('DEV', true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const page = openDocument(memoryStorage());
    const error = chunkError('picker-OLD.js');
    const optional = runOptionalLoad(() =>
      Promise.resolve()
        .then(() => failChunkLoad(error))
        .catch(
          (failure: unknown) =>
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(failure), 1);
            }),
        ),
    );
    const rejected = expect(optional).rejects.toBe(error);
    // Flush Vite's dispatch/rethrow, but leave the importer's catch behind a task.
    await vi.advanceTimersByTimeAsync(0);
    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;

    // A fresh document with a fresh budget makes exemption observable even though
    // the first document already spent its one recovery on this same asset.
    const later = openDocument(memoryStorage());
    expect(() => failChunkLoad(error)).toThrow(error);
    vi.runOnlyPendingTimers();
    expect(later.reload).toHaveBeenCalledTimes(1);
    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledExactlyOnceWith('An optional load failed too late to be exempt from chunk recovery.', error);
  });

  it.each([true, false])('discards an optional claim without a pending event (DEV: %s)', async (dev) => {
    vi.stubEnv('DEV', dev);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const page = openDocument(memoryStorage());
    const error = chunkError('picker-OLD.js');
    await expect(runOptionalLoad(() => Promise.reject(error))).rejects.toBe(error);

    expect(() => failChunkLoad(error)).toThrow(error);
    vi.runOnlyPendingTimers();
    expect(page.reload).toHaveBeenCalledTimes(1);
    if (dev) expect(warn).toHaveBeenCalledExactlyOnceWith('An optional load failed too late to be exempt from chunk recovery.', error);
    else expect(warn).not.toHaveBeenCalled();
  });

  it.each([true, false])('reloads once for shared CSS with one optional and one required importer (optional first: %s)', async (optionalFirst) => {
    const page = openDocument(memoryStorage());
    const error = new Error('Unable to preload CSS for /assets/shared-OLD.css');
    const preload = Promise.reject<void>(error);
    const optional = () => runOptionalLoad(() => importWithCssPreload(preload));
    const required = () => importWithCssPreload(preload);
    const loads = optionalFirst ? [optional(), required()] : [required(), optional()];
    expect(await Promise.allSettled(loads)).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ]);
    expect(page.reload).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(page.reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads for two optional importers sharing the same rejected CSS preload', async () => {
    const page = openDocument(memoryStorage());
    const error = new Error('Unable to preload CSS for /assets/shared-OLD.css');
    const preload = Promise.reject<void>(error);
    const loads = [runOptionalLoad(() => importWithCssPreload(preload)), runOptionalLoad(() => importWithCssPreload(preload))];
    expect(await Promise.allSettled(loads)).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ]);
    vi.runOnlyPendingTimers();
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('still reloads when a needed chunk fails while an optional load is pending', async () => {
    const page = openDocument(memoryStorage());
    let finish: () => void = () => undefined;
    const optional = runOptionalLoad(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    expect(() => failChunkLoad(chunkError('sign-up-route-OLD.js'))).toThrow();
    vi.runOnlyPendingTimers();
    expect(page.reload).toHaveBeenCalledTimes(1);
    finish();
    await optional;
  });

  it('never reloads when session storage is blocked, so there can be no loop', () => {
    const { target, reload } = fakeWindow(() => {
      throw new DOMException('Session storage access denied', 'SecurityError');
    });
    vi.stubGlobal('window', target);
    reloadOnceOnChunkLoadFailure();

    const error = chunkError();
    expect(() => failChunkLoad(error)).toThrow(error);
    vi.runOnlyPendingTimers();
    expect(reload).not.toHaveBeenCalled();
  });
});
