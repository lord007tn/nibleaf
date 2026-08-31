import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class DurableUsageEnqueueError extends Error {
    constructor(readonly outboxPersisted: boolean) {
      super('queue unavailable');
    }
  }
  return { buildAnalyticsEvent: vi.fn(), enqueueAnalyticsEvent: vi.fn(), platformEventCreate: vi.fn(), DurableUsageEnqueueError };
});

vi.mock('@nibleaf/clickhouse', () => ({
  keys: () => ({ ANALYTICS_MODE: 'clickhouse', ANALYTICS_HASH_SALT: 'salt' }),
  clickHouseWritesEnabled: () => true,
  deterministicAnalyticsEventId: () => 'event-a',
  buildAnalyticsEvent: mocks.buildAnalyticsEvent,
}));
vi.mock('@nibleaf/database', () => ({ Prisma: { DbNull: null }, prisma: { platformEvent: { create: mocks.platformEventCreate } } }));
vi.mock('../env', () => ({ env: { APP_URL: 'https://nibleaf.test' } }));
vi.mock('../lib/notify', () => ({ notifyDeployment: vi.fn() }));
vi.mock('../lib/usage-ingest', () => ({
  DurableUsageEnqueueError: mocks.DurableUsageEnqueueError,
  enqueueAnalyticsEvent: mocks.enqueueAnalyticsEvent,
}));

import { recordAttributedFirstPublishReady, trackPublishLifecycle } from './publish';

describe('publish usage queue isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildAnalyticsEvent.mockReturnValue({ eventId: 'event-a', tenantId: 'org-a', projectId: 'project-a' });
    mocks.platformEventCreate.mockResolvedValue({ id: 'event-a' });
  });

  it('keeps publishing non-blocking after the usage outbox is durable and Redis rejects enqueue', async () => {
    mocks.enqueueAnalyticsEvent.mockRejectedValue(new mocks.DurableUsageEnqueueError(true));
    await expect(
      trackPublishLifecycle(
        { id: 'project-a', organizationId: 'org-a', accessMode: 'PUBLIC', config: null },
        'deployment-a',
        { name: 'publish_completed', operationId: 'deployment-a', itemCount: 2 },
        '2026-08-24T00:00:00.000Z',
      ),
    ).resolves.toBeUndefined();
    expect(mocks.buildAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({ occurredAt: '2026-08-24T00:00:00.000Z' }), expect.any(Object));
  });

  it('still fails closed when the relational outbox itself was not persisted', async () => {
    mocks.enqueueAnalyticsEvent.mockRejectedValue(new Error('postgres unavailable'));
    await expect(
      trackPublishLifecycle(
        { id: 'project-a', organizationId: 'org-a', accessMode: 'PUBLIC', config: null },
        'deployment-a',
        { name: 'publish_completed', operationId: 'deployment-a', itemCount: 2 },
        '2026-08-24T00:00:00.000Z',
      ),
    ).rejects.toThrow('postgres unavailable');
  });

  it('records identifier-free source attribution only after a user-initiated READY transition', async () => {
    const attribution = { entry_point: 'organic_content' as const, intent: 'first_publish' as const, source: 'mintlify_introduction' as const };

    await recordAttributedFirstPublishReady(attribution, false);
    expect(mocks.platformEventCreate).toHaveBeenCalledWith({
      data: { type: 'publish_ready', userId: null, projectId: null, metadata: attribution },
    });

    mocks.platformEventCreate.mockClear();
    await recordAttributedFirstPublishReady(attribution, true);
    expect(mocks.platformEventCreate).not.toHaveBeenCalled();
  });
});
