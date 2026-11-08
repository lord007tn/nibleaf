import { expect, it } from 'vitest';
import { aiChatConsentRequired, trustedChatConsent } from './chat-consent';

it('requires identity consent without third-party scripts and rejects a not-required bypass', () => {
  const config = { analytics: { cookieConsent: true } };
  expect(aiChatConsentRequired(config)).toBe(true);
  expect(trustedChatConsent(config, 'not_required')).toBe('unknown');
  expect(trustedChatConsent(config, 'denied')).toBe('denied');
});
it('keeps a disabled legacy consent flow anonymous even if the client claims permission', () => {
  const config = { analytics: { cookieConsent: true }, addons: { consentBanner: { enabled: false } } };
  expect(trustedChatConsent(config, 'granted')).toBe('denied');
  expect(trustedChatConsent(null, 'not_required')).toBe('not_required');
});
