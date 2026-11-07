import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadOnceOnChunkLoadFailure } from './chunk-reload';

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
function failChunkLoad(error: Error) {
  const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: error });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) throw error;
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
  });

  it('registers one listener and reloads the page the first time a chunk fails', () => {
    const storage = memoryStorage();
    const page = openDocument(storage);
    reloadOnceOnChunkLoadFailure();

    const calls = page.addEventListener.mock.calls;
    expect(calls.every(([type]) => type === 'vite:preloadError')).toBe(true);
    expect(new Set(calls.map(([, listener]) => listener)).size).toBe(1);
    expect(() => failChunkLoad(chunkError())).toThrow();
    expect(page.reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads twice for the same failing chunk, however long the reloaded page takes to fail', () => {
    const storage = memoryStorage();
    const first = openDocument(storage);
    expect(() => failChunkLoad(chunkError())).toThrow();
    expect(first.reload).toHaveBeenCalledTimes(1);

    // Each reloaded document fails on the same chunk more than 30 seconds later.
    for (let documents = 0; documents < 4; documents++) {
      vi.advanceTimersByTime(31_000);
      const next = openDocument(storage);
      const repeat = chunkError();
      // The error reaches the router, which renders the route's error component.
      expect(() => failChunkLoad(repeat)).toThrow(repeat);
      expect(next.reload).not.toHaveBeenCalled();
    }
  });

  it('reloads again for a different chunk, but never more than twice in a session', () => {
    const storage = memoryStorage();
    const first = openDocument(storage);
    expect(() => failChunkLoad(chunkError('editor-OLD.js'))).toThrow();
    const second = openDocument(storage);
    expect(() => failChunkLoad(chunkError('settings-OLD.js'))).toThrow();
    const third = openDocument(storage);
    expect(() => failChunkLoad(chunkError('analytics-OLD.js'))).toThrow();

    expect(first.reload).toHaveBeenCalledTimes(1);
    expect(second.reload).toHaveBeenCalledTimes(1);
    expect(third.reload).not.toHaveBeenCalled();
  });

  it('never reloads when session storage is blocked, so there can be no loop', () => {
    const { target, reload } = fakeWindow(() => {
      throw new DOMException('Session storage access denied', 'SecurityError');
    });
    vi.stubGlobal('window', target);
    reloadOnceOnChunkLoadFailure();

    const error = chunkError();
    expect(() => failChunkLoad(error)).toThrow(error);
    expect(reload).not.toHaveBeenCalled();
  });
});
