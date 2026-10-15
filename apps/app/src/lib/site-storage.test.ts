// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readSiteStorage, writeSiteStorage } from './site-storage';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

it.each(['localStorage', 'sessionStorage'] as const)('reads and writes reader preferences when %s is available', (storage) => {
  expect(writeSiteStorage(storage, 'reader-preference', 'dark')).toBe(true);
  expect(readSiteStorage(storage, 'reader-preference')).toBe('dark');
});

it.each(['localStorage', 'sessionStorage'] as const)('keeps documentation usable when the %s property throws', (storage) => {
  vi.spyOn(window, storage, 'get').mockImplementation(() => {
    throw new DOMException('Storage access denied', 'SecurityError');
  });
  expect(readSiteStorage(storage, 'reader-preference')).toBeNull();
  expect(writeSiteStorage(storage, 'reader-preference', 'dark')).toBe(false);
});

it('handles storage read and quota failures', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage access denied', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage is full', 'QuotaExceededError');
  });
  expect(readSiteStorage('localStorage', 'theme')).toBeNull();
  expect(writeSiteStorage('sessionStorage', 'session', 'id')).toBe(false);
});
