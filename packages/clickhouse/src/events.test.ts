import { describe, expect, it } from 'vitest';
import { analyticsBackfillEventId, buildAnalyticsEvent, deterministicAnalyticsEventId, publicAnalyticsEventSchema } from './events';

const context = {
  tenantId: 'tenant-server-derived',
  projectId: 'project-server-derived',
  siteId: 'site-server-derived',
  source: 'public_site' as const,
  receivedAt: new Date('2026-01-01T00:00:00.000Z'),
  hashSalt: 'test-only-independent-salt',
};

describe('analytics event privacy contract', () => {
  it('rejects client-supplied tenant identity', () => {
    expect(() =>
      publicAnalyticsEventSchema.parse({
        tenantId: 'spoofed',
        consentState: 'granted',
        payload: { name: 'page_view', path: 'start' },
      }),
    ).toThrow();
  });

  it('rejects server lifecycle and AI facts from public clients', () => {
    expect(() => publicAnalyticsEventSchema.parse({ payload: { name: 'answer_completed', costMicros: 1 } })).toThrow();
    expect(() => publicAnalyticsEventSchema.parse({ payload: { name: 'publish_completed' } })).toThrow();
  });

  it('never stores raw private search text even with consent and opt-in', () => {
    const event = buildAnalyticsEvent(
      { consentState: 'granted', sessionId: 'raw-session', payload: { name: 'search_query_submitted', query: 'private acquisition plan' } },
      {
        ...context,
        privacy: { visibility: 'private', allowCampaignDimensions: true, allowRawPublicSearchQueries: true },
      },
    );
    expect(event.tenantId).toBe('tenant-server-derived');
    expect(event.sensitiveQueryText).toBeNull();
    expect(event.queryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(event.queryLength).toBe(24);
    expect(event.queryTokenCount).toBe(3);
    expect(event.sessionHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(event.payload)).not.toContain('private acquisition plan');
    expect(JSON.stringify(event)).not.toContain('raw-session');
  });

  it('stores an opted-in public term only after granted consent', () => {
    const event = buildAnalyticsEvent(
      { consentState: 'granted', payload: { name: 'search_query_submitted', query: 'configure webhooks' } },
      {
        ...context,
        privacy: { visibility: 'public', allowCampaignDimensions: false, allowRawPublicSearchQueries: true },
      },
    );
    expect(event.sensitiveQueryText).toBe('configure webhooks');
  });

  it('bounds attribution to a referrer hostname and removes unconsented UTM values', () => {
    const event = buildAnalyticsEvent(
      {
        consentState: 'denied',
        payload: {
          name: 'page_view',
          path: 'guide',
          referrer: 'https://example.com/private/path?email=reader@example.com',
          utmSource: 'newsletter',
        },
      },
      {
        ...context,
        privacy: { visibility: 'public', allowCampaignDimensions: true, allowRawPublicSearchQueries: false },
      },
    );
    expect(event.payload).toMatchObject({ referrer: 'example.com' });
    expect(event.payload).not.toHaveProperty('utmSource');
  });

  it('derives stable UUID ids for retryable lifecycle events', () => {
    expect(deterministicAnalyticsEventId('publish:123')).toBe(deterministicAnalyticsEventId('publish:123'));
    expect(deterministicAnalyticsEventId('publish:123')).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('preserves dual-write UUIDs and upgrades legacy relational ids deterministically', () => {
    const uuid = '00000000-0000-4000-8000-000000000123';
    expect(analyticsBackfillEventId(uuid)).toBe(uuid);
    expect(analyticsBackfillEventId('cmlegacyrow')).toBe(analyticsBackfillEventId('cmlegacyrow'));
    expect(analyticsBackfillEventId('cmlegacyrow')).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
