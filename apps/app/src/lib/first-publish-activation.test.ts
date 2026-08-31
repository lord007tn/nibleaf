// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('does not store or send attribution before consent', async () => {
    expect(trackFirstPublishLanding('mintlify_introduction')).toBe(false);
    expect(trackFirstPublishCta('mintlify_introduction')).toBe(false);
    expect(await recordFirstPublishStage('project_entered')).toBe(false);
    expect(window.localStorage.getItem(FIRST_PUBLISH_CONTEXT_KEY)).toBeNull();
    expect(request).not.toHaveBeenCalled();
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
});
