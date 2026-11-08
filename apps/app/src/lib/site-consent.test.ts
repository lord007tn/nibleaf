// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readSiteConsent, writeSiteConsent } from './site-consent';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it('keeps blocked-storage choices effective for chat and analytics in the same document, scoped by site', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  writeSiteConsent('blocked-one', 'declined');
  expect(readSiteConsent('blocked-one')).toBe('declined');
  expect(readSiteConsent('blocked-two')).toBe('pending');
});
it('honors a cleared persisted choice and a choice changed by another tab', () => {
  writeSiteConsent('persisted', 'accepted');
  localStorage.setItem('nibleaf.analytics.consent.persisted', 'declined');
  expect(readSiteConsent('persisted')).toBe('declined');
  localStorage.removeItem('nibleaf.analytics.consent.persisted');
  expect(readSiteConsent('persisted')).toBe('pending');
});
