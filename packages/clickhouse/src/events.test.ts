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
  it('retains the drafting connection source and rejects credential fields', () => {
    const input = {
      consentState: 'unknown' as const,
      payload: { name: 'answer_completed' as const, provider: 'openai', connectionSource: 'workspace' as const },
    };
    const eventContext = {
      ...context,
      source: 'dashboard' as const,
      privacy: { visibility: 'private' as const, allowCampaignDimensions: false, allowRawPublicSearchQueries: false },
    };
    expect(buildAnalyticsEvent(input, eventContext).payload).toEqual(input.payload);
    const invalid = { ...input, payload: { ...input.payload, apiKey: 'secret' } };
    expect(() => buildAnalyticsEvent(invalid, eventContext)).toThrow();
  });
  it('drops denied/unknown identities and scopes allowed hashes to tenant and project', () => {
    const privacy = { visibility: 'public' as const, allowCampaignDimensions: false, allowRawPublicSearchQueries: true };
    const body = {
      consentState: 'granted' as const,
      sessionId: 'shared-id',
      anonymousUserId: 'same-user',
      payload: { name: 'search_query_submitted' as const, query: 'api key' },
    };
    const first = buildAnalyticsEvent(body, { ...context, privacy });
    const otherProject = buildAnalyticsEvent(body, { ...context, projectId: 'different-project', privacy });
    const otherTenant = buildAnalyticsEvent(body, { ...context, tenantId: 'different-tenant', privacy });
    for (const other of [otherProject, otherTenant]) {
      expect(other.sessionHash).not.toBe(first.sessionHash);
      expect(other.anonymousUserHash).not.toBe(first.anonymousUserHash);
      expect(other.queryHash).not.toBe(first.queryHash);
    }
    for (const consentState of ['denied', 'unknown'] as const) {
      expect(buildAnalyticsEvent({ ...body, consentState }, { ...context, privacy })).toMatchObject({
        sessionHash: null,
        anonymousUserHash: null,
        sensitiveQueryText: null,
      });
    }
  });
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
