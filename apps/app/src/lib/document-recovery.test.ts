import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimDocumentRecovery, onlySpeculativeLoads, runSpeculative, setNavigationPending } from './document-recovery';

const STORAGE_KEY = 'nibleaf.document-recovery';

function memoryStorage(initial?: string): Storage {
  const values = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
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

/** A fresh document on the given session storage (a reload keeps the storage). */
function openDocument(storage: Storage) {
  vi.stubGlobal('window', { sessionStorage: storage, location: { href: 'https://docs.test/a' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setNavigationPending(false);
});

describe('claimDocumentRecovery', () => {
  it('ignores anything in storage that is not a list of recoveries', () => {
    for (const corrupt of ['not json', '[1,2,3]', 'null', '"text"', '{"chunk:a":1}', '[["nav:b","soon"],["nav:c",null],[1,2],["nav:d",1,2]]']) {
      const storage = memoryStorage(corrupt);
      openDocument(storage);
      expect(claimDocumentRecovery('nav:x', { now: 1000 })).toBe(true);
      expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? '')).toEqual([['nav:x', 1000]]);
    }
    // A bloated (or hostile) entry list blocks recovery rather than growing further.
    const bloated = memoryStorage(JSON.stringify(Array.from({ length: 500 }, (_, index) => [`nav:${index}`, index])));
    openDocument(bloated);
    expect(claimDocumentRecovery('nav:new', { now: 1000 })).toBe(false);
    expect(JSON.parse(bloated.getItem(STORAGE_KEY) ?? '[]')).toHaveLength(500);
  });

  it('recovers each key once within its TTL, one recovery per document, two per session', () => {
    const storage = memoryStorage();
    openDocument(storage);
    expect(claimDocumentRecovery('nav:/a', { ttlMs: 60_000, now: 1000 })).toBe(true);
    // The same document: a chunk failing before the load happens shares that recovery.
    expect(claimDocumentRecovery('chunk:/assets/x.js', { now: 1001 })).toBe(false);

    openDocument(storage);
    expect(claimDocumentRecovery('nav:/a', { ttlMs: 60_000, now: 30_000 })).toBe(false);
    expect(claimDocumentRecovery('nav:/a', { ttlMs: 60_000, now: 61_001 })).toBe(true);

    openDocument(storage);
    expect(claimDocumentRecovery('chunk:/assets/y.js', { now: 70_000 })).toBe(false);
  });

  it('never recovers without session storage to record it', () => {
    vi.stubGlobal('window', {
      get sessionStorage() {
        throw new DOMException('denied', 'SecurityError');
      },
      location: {},
    });
    expect(claimDocumentRecovery('nav:/a')).toBe(false);
  });
});

describe('speculative loads', () => {
  it('reports only-speculative while a prefetch runs and the reader is not waiting on a page', async () => {
    let finish: () => void = () => undefined;
    const prefetch = runSpeculative(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    expect(onlySpeculativeLoads()).toBe(true);
    setNavigationPending(true);
    expect(onlySpeculativeLoads()).toBe(false);
    setNavigationPending(false);
    finish();
    await prefetch;
    expect(onlySpeculativeLoads()).toBe(false);
  });

  it('stops counting a prefetch that failed', async () => {
    await expect(runSpeculative(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(onlySpeculativeLoads()).toBe(false);
  });
});
