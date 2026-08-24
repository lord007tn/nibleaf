import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  existingCheckpoint: null as null | { organizationId: string; projectId: string; payloadDigest: string; writtenAt: Date | null },
  marker: null as null | { deletionPendingAt: Date | null },
  queryRaw: vi.fn(),
  checkpointFindUnique: vi.fn(),
  checkpointCreate: vi.fn(),
  checkpointCount: vi.fn(),
  markerFindUnique: vi.fn(),
  markerUpsert: vi.fn(),
  projectFindFirst: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  usageIngestCheckpoint: {
    findUnique: mocks.checkpointFindUnique,
    create: mocks.checkpointCreate,
    count: mocks.checkpointCount,
  },
  project: { findFirst: mocks.projectFindFirst },
  usageStorageMarker: {
    findUnique: mocks.markerFindUnique,
    upsert: mocks.markerUpsert,
  },
};

vi.mock('./client', () => ({
  getDb: () => ({ $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) }),
}));
vi.mock('./keys', () => ({ keys: () => ({ NODE_ENV: 'test', POSTGRES_URL: 'postgresql://test' }) }));
vi.mock('./generated/client', () => ({ Prisma: { sql: (strings: TemplateStringsArray) => strings.join('?') } }));

import { beginUsageDeletion, markUsageStoragePending } from './index';

const event = {
  eventId: '1556c8fc-a234-8d55-9623-822270572dc5',
  schemaVersion: 1 as const,
  occurredAt: '2026-08-24T00:00:00.000Z',
  receivedAt: '2026-08-24T00:00:01.000Z',
  tenantId: 'org-a',
  projectId: 'project-a',
  meterKey: 'search_query' as const,
  quantity: '1',
  kind: 'usage' as const,
  correctionOfEventId: null,
  source: 'worker' as const,
};

describe('usage ingestion checkpoint fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkpointFindUnique.mockImplementation(async () => mocks.existingCheckpoint);
    mocks.markerFindUnique.mockImplementation(async () => mocks.marker);
    mocks.markerUpsert.mockImplementation(
      async ({ create, update }: { create: { deletionPendingAt?: Date }; update: { deletionPendingAt?: Date } }) => {
        const deletionPendingAt = update.deletionPendingAt ?? create.deletionPendingAt;
        if (deletionPendingAt) mocks.marker = { deletionPendingAt };
        return { organizationId: 'org-a' };
      },
    );
    mocks.checkpointCreate.mockResolvedValue({ organizationId: 'org-a', projectId: 'project-a', payloadDigest: 'digest', writtenAt: null });
    mocks.existingCheckpoint = null;
    mocks.marker = null;
    mocks.checkpointCount.mockResolvedValue(0);
    mocks.projectFindFirst.mockResolvedValue({ id: 'project-a' });
  });

  it('rejects a checkpoint id already owned by another tenant before any marker mutation', async () => {
    mocks.existingCheckpoint = { organizationId: 'org-b', projectId: 'project-b', payloadDigest: 'digest', writtenAt: null };
    await expect(markUsageStoragePending({ id: 'shared-id', organizationId: 'org-a', projectId: 'project-a', events: [event] })).rejects.toThrow(
      'checkpoint scope collision',
    );
    expect(mocks.markerUpsert).not.toHaveBeenCalled();
  });

  it('rejects new work after a deletion fence but allows an existing pending receipt to drain', async () => {
    await markUsageStoragePending({ id: 'existing-id', organizationId: 'org-a', projectId: 'project-a', events: [event] });
    const created = mocks.checkpointCreate.mock.calls[0]?.[0]?.data;
    mocks.marker = { deletionPendingAt: new Date() };
    mocks.existingCheckpoint = null;
    await expect(markUsageStoragePending({ id: 'new-id', organizationId: 'org-a', projectId: 'project-a', events: [event] })).rejects.toThrow(
      'fenced for tenant deletion',
    );

    mocks.existingCheckpoint = {
      organizationId: 'org-a',
      projectId: 'project-a',
      payloadDigest: created?.payloadDigest ?? '',
      writtenAt: null,
    };
    await expect(
      markUsageStoragePending({ id: 'existing-id', organizationId: 'org-a', projectId: 'project-a', events: [event] }),
    ).resolves.toBeDefined();
  });

  it('canonicalizes property/order retries, preserves the first receipt time, and rejects changed billing identity', async () => {
    const later = {
      ...event,
      eventId: '2556c8fc-a234-8d55-9623-822270572dc5',
      receivedAt: '2026-08-24T00:00:02.000Z',
    };
    await markUsageStoragePending({ id: 'stable-id', organizationId: 'org-a', projectId: 'project-a', events: [later, event] });
    const created = mocks.checkpointCreate.mock.calls[0]?.[0]?.data;
    expect(created?.events.map((item: { eventId: string }) => item.eventId)).toEqual([event.eventId, later.eventId]);

    mocks.existingCheckpoint = {
      organizationId: 'org-a',
      projectId: 'project-a',
      payloadDigest: created?.payloadDigest ?? '',
      writtenAt: null,
    };
    const eventRetry = { ...event, receivedAt: '2026-08-24T00:05:00.000Z' };
    const laterRetry = { ...later, receivedAt: '2026-08-24T00:05:00.000Z' };
    const retryWithNewReceiptTime = [eventRetry, laterRetry];
    await expect(
      markUsageStoragePending({ id: 'stable-id', organizationId: 'org-a', projectId: 'project-a', events: retryWithNewReceiptTime }),
    ).resolves.toBeDefined();

    await expect(
      markUsageStoragePending({
        id: 'stable-id',
        organizationId: 'org-a',
        projectId: 'project-a',
        events: [{ ...event, quantity: '2' }, laterRetry],
      }),
    ).rejects.toThrow('checkpoint payload collision');
  });

  it('establishes the deletion fence before a new enqueue can create a receipt', async () => {
    await expect(beginUsageDeletion('org-a', 'project-a')).resolves.toMatchObject({ exists: true, pendingCount: 0 });
    await expect(markUsageStoragePending({ id: 'late-id', organizationId: 'org-a', projectId: 'project-a', events: [event] })).rejects.toThrow(
      'fenced for tenant deletion',
    );
    expect(mocks.checkpointCreate).not.toHaveBeenCalled();
  });
});
