import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildAnalyticsEvent: vi.fn(),
  enqueueAnalyticsEvent: vi.fn(),
  projectFindUnique: vi.fn(),
}));

vi.mock('@nibleaf/clickhouse', () => ({
  buildAnalyticsEvent: mocks.buildAnalyticsEvent,
  clickHouseWritesEnabled: () => true,
  deterministicAnalyticsEventId: () => '279c1189-3ff3-88cc-96b7-70f38bfc5ea6',
  keys: () => ({ ANALYTICS_MODE: 'clickhouse', ANALYTICS_HASH_SALT: 'salt' }),
}));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: mocks.projectFindUnique } } }));
vi.mock('./usage-ingest', () => ({ enqueueAnalyticsEvent: mocks.enqueueAnalyticsEvent }));

import { trackExportLifecycle } from './export-analytics';

describe('export analytics durability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindUnique.mockResolvedValue({ id: 'project-a', organizationId: 'org-a', accessMode: 'PRIVATE', config: null });
    mocks.buildAnalyticsEvent.mockReturnValue({ eventId: 'event-a', tenantId: 'org-a', projectId: 'project-a' });
    mocks.enqueueAnalyticsEvent.mockResolvedValue('analytics-job-a');
  });

  it('routes export lifecycle telemetry through the durable analytics queue instead of a direct ClickHouse write', async () => {
    await trackExportLifecycle('project-a', 'export-a', { name: 'export_completed', operationId: 'export-a', itemCount: 2 });
    expect(mocks.enqueueAnalyticsEvent).toHaveBeenCalledWith({ eventId: 'event-a', tenantId: 'org-a', projectId: 'project-a' });
  });

  it('does not fail an export after the durable boundary reports a queue error', async () => {
    mocks.enqueueAnalyticsEvent.mockRejectedValue(new Error('redis unavailable after durable marker'));
    await expect(
      trackExportLifecycle('project-a', 'export-a', { name: 'export_completed', operationId: 'export-a', itemCount: 2 }),
    ).resolves.toBeUndefined();
  });
});
