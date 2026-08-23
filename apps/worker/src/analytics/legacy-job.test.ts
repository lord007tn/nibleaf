import type { LegacyTrackAnalyticsEventJobData } from '@nibleaf/bullmq/jobs/analytics';
import { describe, expect, it } from 'vitest';
import { legacyAnalyticsJobToEnvelope } from './legacy-job';

const base: LegacyTrackAnalyticsEventJobData = {
  kind: 'track-event',
  projectId: 'project-server-lookup',
  type: 'search',
  path: 'docs/private',
  referrer: null,
  query: 'private acquisition plan',
  sessionId: 'legacy-session',
  country: 'sa',
  device: 'desktop',
  language: 'ar',
  createdAt: '2026-08-23T00:00:00.000Z',
};

describe('legacy analytics rolling-deploy compatibility', () => {
  it('upgrades an old queue payload without retaining private query or session text', () => {
    const event = legacyAnalyticsJobToEnvelope(base, {
      tenantId: 'tenant-server-lookup',
      jobId: '47',
      hashSalt: 'test-only-salt',
      privacy: { visibility: 'private', allowCampaignDimensions: false, allowRawPublicSearchQueries: false },
      receivedAt: new Date('2026-08-23T00:01:00.000Z'),
    });
    expect(event).toMatchObject({
      tenantId: 'tenant-server-lookup',
      projectId: 'project-server-lookup',
      consentState: 'unknown',
      sensitiveQueryText: null,
      payload: { name: 'search_query_submitted', path: 'docs/private', language: 'ar' },
    });
    expect(event?.queryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(event)).not.toContain('private acquisition plan');
    expect(JSON.stringify(event)).not.toContain('legacy-session');
  });

  it('deduplicates retry attempts by BullMQ job id and ignores unknown old event types', () => {
    const context = {
      tenantId: 'tenant-server-lookup',
      jobId: 'stable-job',
      hashSalt: 'test-only-salt',
      privacy: { visibility: 'public' as const, allowCampaignDimensions: false, allowRawPublicSearchQueries: true },
      receivedAt: new Date('2026-08-23T00:01:00.000Z'),
    };
    expect(legacyAnalyticsJobToEnvelope(base, context)?.eventId).toBe(legacyAnalyticsJobToEnvelope(base, context)?.eventId);
    expect(legacyAnalyticsJobToEnvelope({ ...base, type: 'unsupported' }, context)).toBeNull();
  });
});
