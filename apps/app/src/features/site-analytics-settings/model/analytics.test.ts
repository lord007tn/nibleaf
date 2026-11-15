import { describe, expect, it } from 'vitest';
import { type AnalyticsValues, analyticsUpdate, analyticsValues, ga4Problem, normalizeAnalytics, plausibleProblem } from './analytics';

const blank: AnalyticsValues = { ga4: '', plausible: '', campaignDimensions: false, storePublicSearchTerms: false };

describe('analyticsValues', () => {
  it('starts blank with both privacy opt-ins off when nothing is configured', () => {
    expect(analyticsValues(null)).toEqual(blank);
    expect(analyticsValues({})).toEqual(blank);
    expect(analyticsValues({ analytics: null })).toEqual(blank);
    expect(analyticsValues({ analytics: { ga4: null, campaignDimensions: null } })).toEqual(blank);
  });

  it('reads the four edited values and nothing else', () => {
    const config = {
      theme: { preset: 'nib' },
      analytics: { ga4: 'G-ABC123', plausible: 'docs.acme.com', cookieConsent: true, campaignDimensions: true, storePublicSearchTerms: false },
    };
    expect(analyticsValues(config)).toEqual({ ga4: 'G-ABC123', plausible: 'docs.acme.com', campaignDimensions: true, storePublicSearchTerms: false });
  });
});

describe('validation', () => {
  it.each(['', '   ', 'G-ABC123', 'g-abc123', '  G-XYZ9  '])('accepts GA4 id %j', (value) => {
    expect(ga4Problem(value)).toBeUndefined();
  });

  it.each(['UA-12345-1', 'G-', 'G-ABC 123', 'GTM-ABC123', 'ABC123'])('refuses GA4 id %j', (value) => {
    expect(ga4Problem(value)).toBe('format');
  });

  it.each(['', '  ', 'docs.acme.com', 'Docs.Acme.COM', 'a-b.example.co.uk', ' acme.io '])('accepts Plausible domain %j', (value) => {
    expect(plausibleProblem(value)).toBeUndefined();
  });

  it.each(['https://docs.acme.com', 'docs.acme.com/path', 'localhost', 'docs.acme.c', 'docs acme.com'])('refuses Plausible domain %j', (value) => {
    expect(plausibleProblem(value)).toBe('format');
  });
});

describe('analyticsUpdate', () => {
  it('sends trimmed identifiers and both opt-ins', () => {
    expect(normalizeAnalytics({ ...blank, ga4: ' G-ABC ', plausible: ' docs.acme.com ' })).toMatchObject({
      ga4: 'G-ABC',
      plausible: 'docs.acme.com',
    });
    expect(
      analyticsUpdate(blank, { ga4: ' G-ABC ', plausible: '\tdocs.acme.com\n', campaignDimensions: true, storePublicSearchTerms: false }),
    ).toEqual({
      ga4: 'G-ABC',
      plausible: 'docs.acme.com',
      campaignDimensions: true,
      storePublicSearchTerms: false,
    });
  });

  it('leaves out an identifier that is blank and was never saved', () => {
    const update = analyticsUpdate(blank, { ...blank, ga4: '   ', campaignDimensions: true });
    expect(update).toEqual({ campaignDimensions: true, storePublicSearchTerms: false });
    expect('ga4' in update).toBe(false);
    expect('plausible' in update).toBe(false);
  });

  // The API merges config.analytics one level deep: a key left out keeps the
  // stored id, so clearing a saved one must send it empty.
  it('clears a saved identifier the person emptied by sending it empty', () => {
    const saved = { ...blank, ga4: 'G-ABC', plausible: 'docs.acme.com' };
    expect(analyticsUpdate(saved, { ...saved, ga4: '  ', plausible: '' })).toEqual({
      ga4: '',
      plausible: '',
      campaignDimensions: false,
      storePublicSearchTerms: false,
    });
  });

  it('sends false explicitly, so turning an opt-in off is stored', () => {
    const on = { ...blank, campaignDimensions: true, storePublicSearchTerms: true };
    expect(analyticsUpdate(on, blank)).toEqual({ campaignDimensions: false, storePublicSearchTerms: false });
  });

  it('never sends cookieConsent, which the consent add-on owns', () => {
    expect(
      Object.keys(analyticsUpdate(blank, { ga4: 'G-A', plausible: 'a.io', campaignDimensions: true, storePublicSearchTerms: true })),
    ).not.toContain('cookieConsent');
  });
});
