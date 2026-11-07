import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadOnceOnChunkLoadFailure } from './chunk-reload';

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://app.nibleaf.test/assets/editor-OLD.js');

function fakeWindow(storage: () => Storage) {
  const target = new EventTarget();
  const reload = vi.fn();
  Object.defineProperty(target, 'sessionStorage', { get: storage });
  Object.defineProperty(target, 'location', { value: { pathname: '/app/projects/p1', reload } });
  return { target, reload };
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

describe('reload once after a chunk fails to load', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reloads the page the first time a chunk fails', () => {
    const storage = memoryStorage();
    const { target, reload } = fakeWindow(() => storage);
    vi.stubGlobal('window', target);
    reloadOnceOnChunkLoadFailure();
    reloadOnceOnChunkLoadFailure();

    expect(() => failChunkLoad(chunkError())).toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem('nibleaf.chunk-reload') ?? '')).toEqual({ at: Date.now(), path: '/app/projects/p1' });
  });

  it('lets the route error UI show instead of reloading again within 30 seconds, and reloads after that', () => {
    const storage = memoryStorage();
    const { target, reload } = fakeWindow(() => storage);
    vi.stubGlobal('window', target);
    reloadOnceOnChunkLoadFailure();

    expect(() => failChunkLoad(chunkError())).toThrow();
    vi.advanceTimersByTime(29_000);
    // The error reaches the router, which renders the route's error component.
    const repeat = chunkError();
    expect(() => failChunkLoad(repeat)).toThrow(repeat);
    expect(reload).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    expect(() => failChunkLoad(chunkError())).toThrow();
    expect(reload).toHaveBeenCalledTimes(2);
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
