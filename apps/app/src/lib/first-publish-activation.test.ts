// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeFirstPublishAttribution,
  FIRST_PUBLISH_CONTEXT_KEY,
  readFirstPublishAttribution,
  recordFirstPublishStage,
  trackFirstPublishCta,
  trackFirstPublishLanding,
} from './first-publish-activation';
import { persistMarketingAnalyticsConsent } from './marketing-analytics';

describe('first-publish attribution privacy boundary', () => {
  const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    request.mockClear();
    vi.stubGlobal('fetch', request);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    persistMarketingAnalyticsConsent('declined');
    vi.unstubAllGlobals();
  });

  it('does not store or send attribution before consent', async () => {
    expect(trackFirstPublishLanding('mintlify_introduction')).toBe(false);
    expect(trackFirstPublishCta('mintlify_introduction')).toBe(false);
    expect(await recordFirstPublishStage('project_entered')).toBe(false);
    expect(window.localStorage.getItem(FIRST_PUBLISH_CONTEXT_KEY)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('withdraws stored attribution so accepting again cannot resurrect the earlier journey', () => {
    persistMarketingAnalyticsConsent('accepted');
    trackFirstPublishCta('mintlify_introduction');
    persistMarketingAnalyticsConsent('declined');
    persistMarketingAnalyticsConsent('accepted');
    expect(readFirstPublishAttribution()).toBeNull();
  });

  it('sends exact allowlisted landing, CTA, and product-stage payloads after consent', async () => {
    persistMarketingAnalyticsConsent('accepted');

    expect(trackFirstPublishLanding('docker_compose_guide')).toBe(true);
    expect(trackFirstPublishCta('docker_compose_guide')).toBe(true);
    expect(await recordFirstPublishStage('project_entered')).toBe(true);
    expect(readFirstPublishAttribution()).toEqual({
      entry_point: 'organic_content',
      intent: 'first_publish',
      source: 'docker_compose_guide',
    });
    completeFirstPublishAttribution({ entry_point: 'organic_content', intent: 'first_publish', source: 'docker_compose_guide' });
    expect(window.localStorage.getItem(FIRST_PUBLISH_CONTEXT_KEY)).toBeNull();

    expect(request).toHaveBeenCalledTimes(3);
    expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toEqual({
      event: 'first_publish_landing_viewed',
      properties: { entry_point: 'organic_content', intent: 'first_publish', source: 'docker_compose_guide' },
    });
    expect(JSON.parse(request.mock.calls[1]?.[1]?.body as string)).toEqual({
      event: 'first_publish_cta_clicked',
      properties: {
        destination: 'signup',
        entry_point: 'organic_content',
        intent: 'first_publish',
        placement: 'article_bridge',
        source: 'docker_compose_guide',
      },
    });
    expect(request.mock.calls[2]?.[0]).toBe('/api/app/activation-events');
    expect(JSON.parse(request.mock.calls[2]?.[1]?.body as string)).toEqual({
      stage: 'project_entered',
      properties: { entry_point: 'organic_content', intent: 'first_publish', source: 'docker_compose_guide' },
    });
    const bodies = request.mock.calls.map((call) => call[1]?.body).join(' ');
    expect(bodies).not.toMatch(/email|projectId|document_text|submitted_html/u);
  });

  it('rejects tampered or expired attribution and deduplicates successful stages', async () => {
    persistMarketingAnalyticsConsent('accepted');
    window.localStorage.setItem(
      FIRST_PUBLISH_CONTEXT_KEY,
      JSON.stringify({
        capturedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        entry_point: 'organic_content',
        intent: 'first_publish',
        projectId: 'must-not-pass',
        source: 'mintlify_introduction',
      }),
    );

    expect(await recordFirstPublishStage('editor_entered')).toBe(false);
    expect(window.localStorage.getItem(FIRST_PUBLISH_CONTEXT_KEY)).toBeNull();

    trackFirstPublishCta('mintlify_introduction');
    expect(await recordFirstPublishStage('editor_entered')).toBe(true);
    expect(await recordFirstPublishStage('editor_entered')).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns no attribution and never interrupts publishing when storage getters throw', async () => {
    for (const storage of ['localStorage', 'sessionStorage'] as const) {
      vi.spyOn(window, storage, 'get').mockImplementation(() => {
        throw new DOMException('Storage access denied', 'SecurityError');
      });
    }

    expect(readFirstPublishAttribution()).toBeNull();
    expect(() =>
      completeFirstPublishAttribution({ entry_point: 'organic_content', intent: 'first_publish', source: 'docker_compose_guide' }),
    ).not.toThrow();
    expect(trackFirstPublishLanding('docker_compose_guide')).toBe(false);
    expect(trackFirstPublishCta('docker_compose_guide')).toBe(false);
    await expect(recordFirstPublishStage('project_entered')).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('returns null if consent is readable but attribution reads are denied', async () => {
    persistMarketingAnalyticsConsent('accepted');
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === FIRST_PUBLISH_CONTEXT_KEY) throw new DOMException('Attribution access denied', 'SecurityError');
      return getItem.call(this, key);
    });

    expect(readFirstPublishAttribution()).toBeNull();
    expect(() =>
      completeFirstPublishAttribution({ entry_point: 'organic_content', intent: 'first_publish', source: 'docker_compose_guide' }),
    ).not.toThrow();
    await expect(recordFirstPublishStage('editor_entered')).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('skips optional landing and stage events when session storage cannot be accessed', async () => {
    persistMarketingAnalyticsConsent('accepted');
    trackFirstPublishCta('mintlify_introduction');
    request.mockClear();
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Session storage access denied', 'SecurityError');
    });

    expect(trackFirstPublishLanding('mintlify_introduction')).toBe(false);
    await expect(recordFirstPublishStage('project_entered')).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not send landing or CTA attribution when their storage writes fail', () => {
    persistMarketingAnalyticsConsent('accepted');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });

    expect(trackFirstPublishLanding('docker_compose_guide')).toBe(false);
    expect(trackFirstPublishCta('docker_compose_guide')).toBe(false);
    expect(readFirstPublishAttribution()).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('does not throw if READY attribution cleanup cannot remove the stored context', () => {
    persistMarketingAnalyticsConsent('accepted');
    trackFirstPublishCta('docker_compose_guide');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage writes denied', 'SecurityError');
    });

    expect(() =>
      completeFirstPublishAttribution({ entry_point: 'organic_content', intent: 'first_publish', source: 'docker_compose_guide' }),
    ).not.toThrow();
  });
});
