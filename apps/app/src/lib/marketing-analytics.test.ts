// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  declineMarketingAnalytics,
  initializeMarketingAnalytics,
  isGa4MeasurementId,
  isGtmContainerId,
  MARKETING_ANALYTICS_CONSENT_KEY,
  persistMarketingAnalyticsConsent,
  selectMarketingAnalyticsTarget,
  sendMarketingAnalyticsEvent,
  sendMarketingCtaEvent,
  sendMarketingPageView,
  suspendMarketingAnalytics,
} from './marketing-analytics';

const GA4_TARGET = { id: 'G-ABC123', provider: 'ga4' } as const;
const GTM_TARGET = { id: 'GTM-ABC123', provider: 'gtm' } as const;

describe('marketing analytics', () => {
  afterEach(() => {
    suspendMarketingAnalytics(GA4_TARGET);
    suspendMarketingAnalytics(GTM_TARGET);
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
    initializeMarketingAnalytics(GA4_TARGET);
    const before = window.dataLayer?.length;

    sendMarketingAnalyticsEvent('newsletter_subscribed', { email: 'private@example.com' });
    sendMarketingAnalyticsEvent('sign_up', { email: 'private@example.com', method: 'email_otp' });

    expect(window.dataLayer).toHaveLength(before ?? 0);
    expect(JSON.stringify(window.dataLayer)).not.toContain('private@example.com');
  });

  it('accepts real Google identifiers and rejects placeholders or injection', () => {
    expect(isGa4MeasurementId('G-ABC123')).toBe(true);
    expect(isGa4MeasurementId('G-XXXXXXXXXX')).toBe(false);
    expect(isGa4MeasurementId('UA-123-4')).toBe(false);
    expect(isGa4MeasurementId('G-ABC123" onload=alert(1)')).toBe(false);
    expect(isGa4MeasurementId('')).toBe(false);
    expect(isGtmContainerId('GTM-ABC123')).toBe(true);
    expect(isGtmContainerId('GTM-XXXXXXX')).toBe(false);
    expect(isGtmContainerId('GTM-ABC123&l=private')).toBe(false);
    expect(selectMarketingAnalyticsTarget({ ga4MeasurementId: 'G-ABC123', gtmContainerId: 'GTM-ABC123' })).toEqual(GTM_TARGET);
  });

  it('loads one nonced GA script only after initialization and disables automatic pageviews', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'csp-nonce');
    meta.content = 'response-nonce';
    document.head.appendChild(meta);

    expect(initializeMarketingAnalytics(GA4_TARGET)).toBe(true);
    expect(initializeMarketingAnalytics(GA4_TARGET)).toBe(true);

    const scripts = [...document.head.querySelectorAll<HTMLScriptElement>('#nibleaf-marketing-ga4')];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.nonce).toBe('response-nonce');
    expect(scripts[0]?.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABC123');
    expect(window.dataLayer).toContainEqual(['config', 'G-ABC123', { anonymize_ip: true, cookie_domain: 'none', send_page_view: false }]);
    expect(window.dataLayer?.filter((entry) => Array.isArray(entry) && entry[0] === 'config')).toHaveLength(1);
  });

  it('loads one nonced GTM container and never loads direct GA for the GTM target', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('property', 'csp-nonce');
    meta.content = 'response-nonce';
    document.head.appendChild(meta);

    expect(initializeMarketingAnalytics(GTM_TARGET)).toBe(true);
    expect(initializeMarketingAnalytics(GTM_TARGET)).toBe(true);

    const scripts = [...document.head.querySelectorAll<HTMLScriptElement>('#nibleaf-marketing-gtm')];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.nonce).toBe('response-nonce');
    expect(scripts[0]?.src).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-ABC123');
    expect(document.querySelector('#nibleaf-marketing-ga4')).toBeNull();
    expect(window.dataLayer).toContainEqual(expect.objectContaining({ event: 'gtm.js' }));
    expect(window.dataLayer).not.toContainEqual(expect.arrayContaining(['config']));
  });

  it('sends a query-free pageview and allowlisted Arabic CTA dimensions', () => {
    window.history.replaceState({}, '', '/ar');
    initializeMarketingAnalytics(GA4_TARGET);
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

  it('queues standard gtag events for the GTM-managed Google tag', () => {
    window.history.replaceState({}, '', '/ar');
    initializeMarketingAnalytics(GTM_TARGET);
    sendMarketingPageView('/ar?email=private@example.com', 'ar');
    sendMarketingCtaEvent({ destination: 'signup', language: 'ar', placement: 'hero' });
    sendMarketingAnalyticsEvent('sign_up', { method: 'email_otp' });
    sendMarketingAnalyticsEvent('free_tool_started', {
      input_mode: 'html',
      page_path: '/tools/rtl-documentation-readiness',
      product: 'nibleaf',
      rubric_version: '1.0.0',
      tool_slug: 'rtl-documentation-readiness',
    });
    sendMarketingAnalyticsEvent('free_tool_completed', {
      category_count: 6,
      checks_run: 18,
      checks_unknown: 0,
      product: 'nibleaf',
      result_type: 'strong_evidence',
      rubric_version: '1.0.0',
      tool_slug: 'rtl-documentation-readiness',
    });
    sendMarketingAnalyticsEvent('free_tool_cta_clicked', {
      destination: 'sample_project_signup',
      placement: 'result_bridge',
      product: 'nibleaf',
      tool_slug: 'rtl-documentation-readiness',
    });

    expect(window.dataLayer).toContainEqual([
      'event',
      'page_view',
      expect.objectContaining({ language: 'ar', page_location: 'http://localhost:3000/ar', page_path: '/ar' }),
    ]);
    expect(window.dataLayer).toContainEqual([
      'event',
      'cta_clicked',
      expect.objectContaining({ destination: 'signup', language: 'ar', placement: 'hero' }),
    ]);
    for (const event of ['sign_up', 'free_tool_started', 'free_tool_completed', 'free_tool_cta_clicked']) {
      expect(window.dataLayer).toContainEqual(['event', event, expect.any(Object)]);
    }
    expect(JSON.stringify(window.dataLayer)).not.toContain('private@example.com');
    expect(JSON.stringify(window.dataLayer)).not.toContain('send_to');
  });

  it('persists refusal, denies analytics storage, and activates the GA disable flag', () => {
    initializeMarketingAnalytics(GA4_TARGET);
    persistMarketingAnalyticsConsent('accepted');
    declineMarketingAnalytics(GA4_TARGET);

    expect(window.localStorage.getItem(MARKETING_ANALYTICS_CONSENT_KEY)).toBe('declined');
    expect(window['ga-disable-G-ABC123']).toBe(true);
    expect(window.dataLayer).toContainEqual(['consent', 'update', expect.objectContaining({ ad_storage: 'denied', analytics_storage: 'denied' })]);
  });

  it('stops GTM event delivery and denies analytics storage after withdrawal', () => {
    initializeMarketingAnalytics(GTM_TARGET);
    persistMarketingAnalyticsConsent('accepted');
    declineMarketingAnalytics(GTM_TARGET);
    const before = window.dataLayer?.length;

    sendMarketingPageView('/ar', 'ar');
    sendMarketingAnalyticsEvent('sign_up', { method: 'email_otp' });

    expect(window.localStorage.getItem(MARKETING_ANALYTICS_CONSENT_KEY)).toBe('declined');
    expect(window.dataLayer).toHaveLength(before ?? 0);
    expect(window.dataLayer).toContainEqual(['consent', 'update', expect.objectContaining({ analytics_storage: 'denied' })]);
  });
});
