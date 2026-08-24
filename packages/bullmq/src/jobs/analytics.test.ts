import { describe, expect, it } from 'vitest';
import { analyticsIngestJobId, usageIngestJobId } from './analytics';

const usageEvent = (tenantId: string, projectId: string) => ({
  eventId: '1556c8fc-a234-8d55-9623-822270572dc5',
  schemaVersion: 1 as const,
  occurredAt: '2026-08-24T00:00:00.000Z',
  receivedAt: '2026-08-24T00:00:01.000Z',
  tenantId,
  projectId,
  meterKey: 'search_query' as const,
  quantity: '1',
  kind: 'usage' as const,
  correctionOfEventId: null,
  source: 'worker' as const,
});

describe('tenant-scoped analytics queue ids', () => {
  it('keeps retry ids stable while separating identical event ids across tenants and projects', () => {
    const first = usageEvent('org-a', 'project-a');
    const second = { ...first, eventId: '2556c8fc-a234-8d55-9623-822270572dc5' };
    expect(usageIngestJobId([first])).toBe(usageIngestJobId([first]));
    expect(usageIngestJobId([first, second])).toBe(usageIngestJobId([second, first]));
    expect(usageIngestJobId([first])).not.toBe(usageIngestJobId([usageEvent('org-b', 'project-b')]));
    expect(analyticsIngestJobId(first)).not.toBe(analyticsIngestJobId(usageEvent('org-b', 'project-b')));
  });
});
