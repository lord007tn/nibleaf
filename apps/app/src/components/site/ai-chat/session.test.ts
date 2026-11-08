// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readerSession } from './session';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});
it.each(['unknown', 'denied'] as const)('does not access identity storage for %s consent', (consent) => {
  const storage = vi.spyOn(Storage.prototype, 'getItem');
  const uuid = vi.spyOn(crypto, 'randomUUID');
  expect(readerSession('one', consent)).toBeUndefined();
  expect(storage).not.toHaveBeenCalled();
  expect(uuid).not.toHaveBeenCalled();
});
it('keeps identities stable per project when allowed, and omits them for blocked storage', () => {
  const first = readerSession('one', 'granted');
  expect(first).toBeTruthy();
  expect(readerSession('one', 'not_required')).toBe(first);
  expect(readerSession('two', 'granted')).not.toBe(first);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readerSession('one', 'granted')).toBeUndefined();
});
