// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  declineMarketingAnalytics,
  initializeMarketingAnalytics,
  isGa4MeasurementId,
  MARKETING_ANALYTICS_CONSENT_KEY,
  persistMarketingAnalyticsConsent,
  sendMarketingAnalyticsEvent,
  sendMarketingCtaEvent,
  sendMarketingPageView,
  suspendMarketingAnalytics,
} from './marketing-analytics';

describe('marketing analytics', () => {
  afterEach(() => {
    suspendMarketingAnalytics('G-ABC123');
    document.head.replaceChildren();
    window.history.replaceState({}, '', '/');
    window.localStorage.clear();
    Reflect.deleteProperty(window, 'dataLayer');
    Reflect.deleteProperty(window, 'gtag');
    Reflect.deleteProperty(window, 'ga-disable-G-ABC123');
    vi.restoreAllMocks();
  });

  it('does not send marketing events through an unrelated pre-existing gtag client', () => {
    const unrelatedGtag = vi.fn();
    window.gtag = unrelatedGtag;

    sendMarketingAnalyticsEvent('sign_up', { method: 'email_otp' });

    expect(unrelatedGtag).not.toHaveBeenCalled();
  });

  it('rejects unapproved events and extra properties at the final GA boundary', () => {
    initializeMarketingAnalytics('G-ABC123');
    const before = window.dataLayer?.length;

    sendMarketingAnalyticsEvent('newsletter_subscribed', { email: 'private@example.com' });
    sendMarketingAnalyticsEvent('sign_up', { email: 'private@example.com', method: 'email_otp' });

    expect(window.dataLayer).toHaveLength(before ?? 0);
    expect(JSON.stringify(window.dataLayer)).not.toContain('private@example.com');
  });

  it('accepts real GA4 measurement IDs and rejects placeholders or injection', () => {
    expect(isGa4MeasurementId('G-ABC123')).toBe(true);
    expect(isGa4MeasurementId('G-XXXXXXXXXX')).toBe(false);
    expect(isGa4MeasurementId('UA-123-4')).toBe(false);
    expect(isGa4MeasurementId('G-ABC123" onload=alert(1)')).toBe(false);
    expect(isGa4MeasurementId('')).toBe(false);
  });

  it('loads one nonced GA script only after initialization and disables automatic pageviews', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'csp-nonce');
    meta.content = 'response-nonce';
    document.head.appendChild(meta);

    expect(initializeMarketingAnalytics('G-ABC123')).toBe(true);
    expect(initializeMarketingAnalytics('G-ABC123')).toBe(true);

    const scripts = [...document.head.querySelectorAll<HTMLScriptElement>('#nibleaf-marketing-ga4')];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.nonce).toBe('response-nonce');
    expect(scripts[0]?.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABC123');
    expect(window.dataLayer).toContainEqual(['config', 'G-ABC123', { anonymize_ip: true, cookie_domain: 'none', send_page_view: false }]);
  });

  it('sends a query-free pageview and allowlisted Arabic CTA dimensions', () => {
    window.history.replaceState({}, '', '/ar');
    initializeMarketingAnalytics('G-ABC123');
    sendMarketingPageView('/ar?email=private@example.com', 'ar');
    sendMarketingCtaEvent({ destination: 'signup', language: 'ar', placement: 'hero' });

    expect(window.dataLayer).toContainEqual([
      'event',
      'page_view',
      expect.objectContaining({ language: 'ar', page_location: 'http://localhost:3000/ar', page_path: '/ar', send_to: 'G-ABC123' }),
    ]);
    expect(window.dataLayer).toContainEqual([
      'event',
      'cta_clicked',
      expect.objectContaining({ destination: 'signup', language: 'ar', placement: 'hero', send_to: 'G-ABC123' }),
    ]);
    expect(JSON.stringify(window.dataLayer)).not.toContain('private@example.com');
  });

  it('persists refusal, denies analytics storage, and activates the GA disable flag', () => {
    initializeMarketingAnalytics('G-ABC123');
    persistMarketingAnalyticsConsent('accepted');
    declineMarketingAnalytics('G-ABC123');

    expect(window.localStorage.getItem(MARKETING_ANALYTICS_CONSENT_KEY)).toBe('declined');
    expect(window['ga-disable-G-ABC123']).toBe(true);
    expect(window.dataLayer).toContainEqual(['consent', 'update', expect.objectContaining({ ad_storage: 'denied', analytics_storage: 'denied' })]);
  });
});
