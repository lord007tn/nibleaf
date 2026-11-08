import { expect, it } from 'vitest';
import { analyticsConsentPolicy } from './analytics-consent';

it('requires consent for first-party identity even without third-party scripts', () => {
  expect(analyticsConsentPolicy({ analytics: { cookieConsent: true } })).toBe('required');
  expect(analyticsConsentPolicy({ addons: { consentBanner: { enabled: true } } })).toBe('required');
  expect(analyticsConsentPolicy(null)).toBe('not_required');
  expect(analyticsConsentPolicy({ addons: { consentBanner: { enabled: false } }, analytics: { cookieConsent: true } })).toBe('blocked');
});
