import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  planFindUnique: vi.fn(),
  organizationFindUnique: vi.fn(),
  deploymentFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  assertProjectAccess: vi.fn(),
  queryUsageMeterTotals: vi.fn(),
  pendingFindFirst: vi.fn(),
  memberFindUnique: vi.fn(),
  projectFindMany: vi.fn(),
  analyticsMode: 'disabled',
  UsageHistoryUnavailableError: class UsageHistoryUnavailableError extends Error {},
}));

vi.mock('@nibleaf/clickhouse', () => ({
  keys: () => ({ ANALYTICS_MODE: mocks.analyticsMode }),
  queryUsageMeterTotals: mocks.queryUsageMeterTotals,
  UsageHistoryUnavailableError: mocks.UsageHistoryUnavailableError,
}));
vi.mock('@nibleaf/database', () => ({
  Prisma: { DbNull: Symbol('DbNull'), sql: (strings: TemplateStringsArray) => strings.join('?') },
  prisma: {
    project: { findUnique: mocks.projectFindUnique, findMany: mocks.projectFindMany },
    member: { findUnique: mocks.memberFindUnique },
    organizationUsagePlan: { findUnique: mocks.planFindUnique },
    organization: { findUnique: mocks.organizationFindUnique },
    deployment: { findFirst: mocks.deploymentFindFirst },
    usageIngestCheckpoint: { findFirst: mocks.pendingFindFirst },
    $queryRaw: mocks.queryRaw,
  },
}));
vi.mock('./projects', () => ({ assertProjectAccess: mocks.assertProjectAccess, assertProjectInOrg: vi.fn() }));

import {
  checkProjectEntitlement,
  exportProjectUsage,
  getOrganizationUsageSummary,
  getProjectEntitlements,
  getProjectUsageSummary,
  resolveProjectCapability,
} from './usage';

const apiContext = (projectId: string, scopes: string[] = []) =>
  ({
    get: (key: string) => (key === 'apiKey' ? { id: 'key-1', projectId, scopes } : key === 'user' ? null : null),
  }) as never;

const sessionContext = () =>
  ({
    get: (key: string) => (key === 'user' ? { id: 'user-a' } : null),
  }) as never;

const activePlan = (entitlements: Array<Record<string, unknown>> = [], meters: Array<Record<string, unknown>> = []) => ({
  status: 'active',
  effectiveAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: null,
  plan: { key: 'pro', active: true, meters, entitlements },
});

describe('usage authorization and entitlement policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.analyticsMode = 'disabled';
    mocks.projectFindUnique.mockResolvedValue({ id: 'project-a', organizationId: 'org-a', dataTenantId: 'original-partition' });
    mocks.assertProjectAccess.mockResolvedValue({ organizationId: 'org-a', role: 'owner', project: { dataTenantId: 'original-partition' } });
    mocks.memberFindUnique.mockResolvedValue({ role: 'owner', orgRole: 'owner' });
    mocks.organizationFindUnique.mockResolvedValue({ metadata: null });
    mocks.planFindUnique.mockResolvedValue(activePlan());
    mocks.deploymentFindFirst.mockResolvedValue({ pagesCount: 12 });
    mocks.queryRaw
      .mockResolvedValueOnce([{ quantity: 2n }])
      .mockResolvedValueOnce([{ quantity: 1_610_612_736n }])
      .mockResolvedValueOnce([{ quantity: 1n }]);
    mocks.pendingFindFirst.mockResolvedValue(null);
  });

  const setSnapshots = (values: { members?: bigint | null; assets?: bigint | null; domains?: bigint | null; pages?: number | null } = {}) => {
    mocks.queryRaw.mockReset();
    const quantities = [
      'members' in values ? values.members : 2n,
      'assets' in values ? values.assets : 1_610_612_736n,
      'domains' in values ? values.domains : 1n,
    ];
    for (const quantity of quantities) {
      mocks.queryRaw.mockResolvedValueOnce(quantity === null ? [] : [{ quantity }]);
    }
    mocks.deploymentFindFirst.mockResolvedValue(values.pages === null ? null : { pagesCount: values.pages ?? 12 });
  };

  const aggregateRows = [
    { meterKey: 'public_page_view', quantity: '10', eventCount: '10', lateEventCount: '0', lastReceivedAt: '2026-08-23T00:00:00Z' },
    { meterKey: 'search_query', quantity: '4', eventCount: '4', lateEventCount: '0', lastReceivedAt: '2026-08-23T00:00:00Z' },
    { meterKey: 'ai_answer', quantity: '2', eventCount: '2', lateEventCount: '0', lastReceivedAt: '2026-08-23T00:00:00Z' },
    { meterKey: 'ai_input_token', quantity: '20', eventCount: '2', lateEventCount: '0', lastReceivedAt: '2026-08-23T00:00:00Z' },
    { meterKey: 'ai_output_token', quantity: '8', eventCount: '2', lateEventCount: '0', lastReceivedAt: '2026-08-23T00:00:00Z' },
  ];

  it('returns ordinary not-found for an API key bound to another project', async () => {
    await expect(
      resolveProjectCapability(apiContext('project-b'), 'project-a', { capabilityKey: 'addons.feedback', eligiblePlanKeys: ['pro'] }),
    ).rejects.toMatchObject({
      code: 'database:not_found',
    });
    expect(mocks.planFindUnique).not.toHaveBeenCalled();
  });

  it('degrades an entitlement linked to an inactive meter to unknown', async () => {
    mocks.planFindUnique.mockResolvedValue(
      activePlan([{ capabilityKey: 'addons.feedback', enabled: true, limit: 10n, behavior: 'block', meter: { key: 'search_query', active: false } }]),
    );
    await expect(
      resolveProjectCapability(apiContext('project-a', ['addons:read']), 'project-a', {
        capabilityKey: 'addons.feedback',
        eligiblePlanKeys: ['pro'],
      }),
    ).resolves.toMatchObject({ availability: 'unavailable', decision: 'unknown', meterKey: null, limit: null });

    await expect(getProjectEntitlements(apiContext('project-a', ['entitlements:read']), 'project-a')).resolves.toMatchObject({
      availability: 'partial',
      entitlements: [{ capabilityKey: 'addons.feedback', availability: 'unavailable', enabled: false, meterKey: null, limit: null }],
    });
  });

  it('does not grant an expired plan', async () => {
    mocks.planFindUnique.mockResolvedValue({ ...activePlan(), expiresAt: new Date('2026-02-01T00:00:00Z') });
    await expect(
      resolveProjectCapability(apiContext('project-a'), 'project-a', { capabilityKey: 'addons.feedback', eligiblePlanKeys: ['pro'] }),
    ).resolves.toMatchObject({ availability: 'unavailable', decision: 'unknown', source: 'plan' });
  });

  it('treats oversized compatibility metadata as unknown without parsing it', async () => {
    mocks.planFindUnique.mockResolvedValue(null);
    mocks.organizationFindUnique.mockResolvedValue({ metadata: `{${' '.repeat(65_537)}}` });
    await expect(
      resolveProjectCapability(apiContext('project-a'), 'project-a', { capabilityKey: 'addons.feedback', eligiblePlanKeys: ['free'] }),
    ).resolves.toMatchObject({ availability: 'unavailable', decision: 'unknown', source: null });
  });

  it('uses READY snapshot pages, active seats/domains, and ignores inactive plan meters', async () => {
    mocks.planFindUnique.mockResolvedValue(
      activePlan([], [{ behavior: 'block', limit: 99n, warningRatio: 80, meter: { key: 'search_query', unit: 'count', active: false } }]),
    );
    const summary = await getProjectUsageSummary(sessionContext(), 'project-a');
    expect(summary.meters.find((meter) => meter.key === 'published_page')).toMatchObject({ quantity: '12', availability: 'complete' });
    expect(summary.meters.find((meter) => meter.key === 'asset_storage_byte')).toMatchObject({ quantity: '1610612736' });
    expect(summary.meters.find((meter) => meter.key === 'search_query')).toMatchObject({ limit: null, availability: 'unavailable' });
    expect(mocks.deploymentFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'READY' }) }));
    expect(mocks.queryRaw.mock.calls.map(([query]) => String(query)).join(' ')).toMatch(/suspendedAt.*banned.*verified.*VERIFIED.*ACTIVE/su);
  });

  it('returns a stable validation error for malformed capability keys', async () => {
    await expect(
      resolveProjectCapability(apiContext('project-a'), 'project-a', { capabilityKey: 'Bad key!', eligiblePlanKeys: ['pro'] }),
    ).rejects.toMatchObject({ code: 'validation:failed' });
  });

  it('projects complete, partial, and unavailable summaries without inventing unknown quantities', async () => {
    mocks.analyticsMode = 'clickhouse';
    mocks.queryUsageMeterTotals.mockResolvedValue(aggregateRows);
    await expect(getProjectUsageSummary(sessionContext(), 'project-a')).resolves.toMatchObject({
      availability: 'complete',
      meters: expect.arrayContaining([expect.objectContaining({ key: 'public_page_view', quantity: '10', availability: 'complete' })]),
    });

    setSnapshots();
    mocks.queryUsageMeterTotals.mockResolvedValue(aggregateRows.filter((row) => !row.meterKey.includes('token')));
    const partial = await getProjectUsageSummary(sessionContext(), 'project-a');
    expect(partial.availability).toBe('partial');
    expect(partial.meters.find((meter) => meter.key === 'ai_input_token')).toMatchObject({ quantity: null, availability: 'partial' });

    setSnapshots({ members: null, assets: null, domains: null, pages: null });
    mocks.queryUsageMeterTotals.mockRejectedValue(new Error('private clickhouse endpoint and credentials'));
    const unavailable = await getProjectUsageSummary(sessionContext(), 'project-a');
    expect(unavailable.availability).toBe('unavailable');
    expect(unavailable.meters.every((meter) => meter.quantity === null)).toBe(true);
    expect(JSON.stringify(unavailable)).not.toContain('private clickhouse');
  });

  it('names why every missing number is missing (audit WORKSPACE-19)', async () => {
    const reason = (summary: Awaited<ReturnType<typeof getProjectUsageSummary>>, key: string) =>
      summary.meters.find((meter) => meter.key === key)?.unavailableReason;
    mocks.analyticsMode = 'postgres';
    const disabled = await getProjectUsageSummary(sessionContext(), 'project-a');
    expect(reason(disabled, 'public_page_view')).toBe('metering_disabled');
    expect(disabled.meters.filter((meter) => meter.quantity === null).every((meter) => meter.unavailableReason)).toBe(true);
    expect(disabled.meters.filter((meter) => meter.quantity !== null).every((meter) => meter.unavailableReason === null)).toBe(true);

    mocks.analyticsMode = 'clickhouse';
    setSnapshots();
    mocks.queryUsageMeterTotals.mockResolvedValue(aggregateRows.filter((row) => !row.meterKey.includes('token')));
    const tokens = await getProjectUsageSummary(sessionContext(), 'project-a');
    expect(reason(tokens, 'ai_input_token')).toBe('tokens_incomplete');
    expect(reason(tokens, 'public_page_view')).toBeNull();

    setSnapshots({ members: null, assets: null, domains: null, pages: null });
    mocks.queryUsageMeterTotals.mockRejectedValue(new Error('private clickhouse endpoint and credentials'));
    const failed = await getProjectUsageSummary(sessionContext(), 'project-a');
    expect(reason(failed, 'search_query')).toBe('query_failed');
    expect(reason(failed, 'published_page')).toBe('not_measured');

    setSnapshots();
    mocks.queryUsageMeterTotals.mockResolvedValue(aggregateRows);
    mocks.pendingFindFirst.mockResolvedValueOnce({ enqueuedAt: new Date() });
    expect(reason(await getProjectUsageSummary(sessionContext(), 'project-a'), 'search_query')).toBe('catching_up');
    setSnapshots();
    mocks.pendingFindFirst.mockResolvedValueOnce({ enqueuedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    expect(reason(await getProjectUsageSummary(sessionContext(), 'project-a'), 'search_query')).toBe('delayed');
  });

  it('reports overlapping durable ingestion as partial and stale pending work as unavailable', async () => {
    mocks.analyticsMode = 'clickhouse';
    mocks.queryUsageMeterTotals.mockResolvedValue(aggregateRows);
    mocks.pendingFindFirst.mockResolvedValueOnce({ enqueuedAt: new Date() });
    const partial = await getProjectUsageSummary(sessionContext(), 'project-a', {
      periodStart: '2026-08-01T00:00:00Z',
      periodEndExclusive: '2026-09-01T00:00:00Z',
    });
    expect(partial.meters.find((meter) => meter.key === 'search_query')).toMatchObject({ availability: 'partial', quantity: null });
    expect(partial.meters.find((meter) => meter.key === 'ai_input_token')).toMatchObject({ availability: 'partial', quantity: null });

    setSnapshots();
    mocks.pendingFindFirst.mockResolvedValueOnce({ enqueuedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    const unavailable = await getProjectUsageSummary(sessionContext(), 'project-a', {
      periodStart: '2026-08-01T00:00:00Z',
      periodEndExclusive: '2026-09-01T00:00:00Z',
    });
    expect(unavailable.meters.find((meter) => meter.key === 'search_query')).toMatchObject({ availability: 'unavailable', quantity: null });
    expect(mocks.pendingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: 'project-a', writtenAt: null }) }),
    );
  });

  it('enforces exact public read scopes for summaries, entitlements, and checks', async () => {
    await expect(getProjectUsageSummary(apiContext('project-a'), 'project-a')).rejects.toMatchObject({ code: 'auth:insufficient_scope' });
    await expect(getProjectEntitlements(apiContext('project-a', ['usage:read']), 'project-a')).rejects.toMatchObject({
      code: 'auth:insufficient_scope',
    });
    await expect(checkProjectEntitlement(apiContext('project-a', ['usage:read']), 'project-a', 'addons.feedback')).rejects.toMatchObject({
      code: 'auth:insufficient_scope',
    });

    mocks.planFindUnique.mockResolvedValue(
      activePlan([{ capabilityKey: 'addons.feedback', enabled: true, limit: null, behavior: 'observe', meter: null }]),
    );
    await expect(checkProjectEntitlement(apiContext('project-a', ['entitlements:read']), 'project-a', 'addons.feedback')).resolves.toMatchObject({
      capabilityKey: 'addons.feedback',
      enabled: true,
    });
    await expect(getProjectEntitlements(sessionContext(), 'project-a')).resolves.toMatchObject({ planKey: 'pro', availability: 'complete' });
  });

  it('rejects invalid, reversed, and overlong half-open periods', async () => {
    for (const period of [
      { periodStart: 'not-a-date', periodEndExclusive: '2026-02-01T00:00:00Z' },
      { periodStart: '2026-02-01T00:00:00Z', periodEndExclusive: '2026-01-01T00:00:00Z' },
      { periodStart: '2024-01-01T00:00:00Z', periodEndExclusive: '2026-01-01T00:00:00Z' },
    ]) {
      await expect(getProjectUsageSummary(sessionContext(), 'project-a', period)).rejects.toMatchObject({
        code: 'usage:invalid_period',
      });
    }
  });

  it('exports aggregate-only facts for owner/admin sessions and denies API keys or members', async () => {
    mocks.analyticsMode = 'clickhouse';
    mocks.queryUsageMeterTotals.mockResolvedValue([
      { meterKey: 'build', quantity: '2', eventCount: '2', lateEventCount: '0', lastReceivedAt: '2026-08-23T00:00:00Z' },
    ]);
    const period = { periodStart: '2026-08-01T00:00:00Z', periodEndExclusive: '2026-09-01T00:00:00Z' };
    await expect(exportProjectUsage(apiContext('project-a', ['usage:export']), 'project-a', period)).rejects.toMatchObject({
      code: 'auth:insufficient_role',
    });

    mocks.assertProjectAccess.mockResolvedValueOnce({ organizationId: 'org-a', role: 'member', project: { dataTenantId: 'original-partition' } });
    await expect(exportProjectUsage(sessionContext(), 'project-a', period)).rejects.toMatchObject({ code: 'auth:insufficient_role' });

    for (const role of ['admin', 'owner']) {
      mocks.assertProjectAccess.mockResolvedValueOnce({ organizationId: 'org-a', role, project: { dataTenantId: 'original-partition' } });
      const exported = await exportProjectUsage(sessionContext(), 'project-a', period);
      expect(exported).toEqual({
        schemaVersion: 1,
        projectId: 'project-a',
        period: { start: '2026-08-01T00:00:00.000Z', endExclusive: '2026-09-01T00:00:00.000Z', timezone: 'UTC' },
        meters: [{ key: 'build', quantity: '2' }],
      });
      expect(JSON.stringify(exported)).not.toMatch(/eventCount|lateEventCount|lastReceivedAt|prompt|content/iu);
    }
  });

  it('blocks late or reconciliation-pending exports and sanitizes ClickHouse failures', async () => {
    mocks.analyticsMode = 'clickhouse';
    const period = { periodStart: '2026-08-01T00:00:00Z', periodEndExclusive: '2026-09-01T00:00:00Z' };
    mocks.pendingFindFirst.mockResolvedValueOnce({ id: 'pending-usage' });
    await expect(exportProjectUsage(sessionContext(), 'project-a', period)).rejects.toMatchObject({ code: 'usage:export_not_ready' });

    mocks.pendingFindFirst.mockResolvedValue(null);
    mocks.queryUsageMeterTotals.mockResolvedValueOnce([
      { meterKey: 'build', quantity: '2', eventCount: '2', lateEventCount: '1', lastReceivedAt: '2026-08-23T00:00:00Z' },
    ]);
    await expect(exportProjectUsage(sessionContext(), 'project-a', period)).rejects.toMatchObject({ code: 'usage:export_not_ready' });

    mocks.queryUsageMeterTotals.mockRejectedValueOnce(new mocks.UsageHistoryUnavailableError('coverage row missing'));
    await expect(exportProjectUsage(sessionContext(), 'project-a', period)).rejects.toMatchObject({
      code: 'usage:export_not_ready',
      message: 'Usage reconciliation is not complete.',
    });

    mocks.queryUsageMeterTotals.mockRejectedValueOnce(new Error('internal backend diagnostic: clickhouse-node-01'));
    const failure = await exportProjectUsage(sessionContext(), 'project-a', period).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'usage:unavailable', message: 'Usage facts are unavailable.' });
    expect(String(failure)).not.toContain('clickhouse-node-01');
  });
  it('withholds plan, seats and limits from a site-only Viewer and keeps the original partition after a move', async () => {
    mocks.analyticsMode = 'clickhouse';
    mocks.queryUsageMeterTotals.mockResolvedValue(aggregateRows);
    mocks.memberFindUnique.mockResolvedValue({ role: 'viewer', orgRole: 'member' });
    mocks.queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ quantity: 12n }])
      .mockResolvedValueOnce([{ quantity: 1n }]);
    const summary = await getProjectUsageSummary(sessionContext(), 'project-a');
    expect(JSON.parse(JSON.stringify(summary))).not.toHaveProperty('plan');
    expect(summary.meters.some((meter) => meter.key === 'editor_seat')).toBe(false);
    expect(summary.meters.every((meter) => meter.limit === undefined)).toBe(true);
    expect(mocks.planFindUnique).not.toHaveBeenCalled();
    expect(mocks.queryUsageMeterTotals).toHaveBeenCalledWith('original-partition', 'project-a', expect.any(String), expect.any(String));
    expect(mocks.pendingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ partitionId: 'original-partition' }) }),
    );
  });

  it('counts seats once while summing website partitions and propagates incomplete data', async () => {
    mocks.analyticsMode = 'clickhouse';
    mocks.projectFindMany.mockResolvedValue([{ id: 'project-a' }, { id: 'project-b' }]);
    mocks.projectFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ dataTenantId: `partition-${where.id}` }));
    mocks.queryRaw
      .mockReset()
      .mockImplementation(async (sql: string) => [{ quantity: sql.includes('DISTINCT') ? 3n : sql.includes('SUM') ? 10n : 1n }]);
    mocks.queryUsageMeterTotals.mockResolvedValue(aggregateRows);
    const complete = await getOrganizationUsageSummary('user-a', 'org-a');
    expect(complete.meters.find((meter) => meter.key === 'editor_seat')?.quantity).toBe('3');
    expect(complete.meters.find((meter) => meter.key === 'asset_storage_byte')?.quantity).toBe('20');
    expect(complete.meters.find((meter) => meter.key === 'public_page_view')?.quantity).toBe('20');
    expect(mocks.queryRaw.mock.calls.filter(([sql]) => String(sql).includes('DISTINCT'))).toHaveLength(1);
    expect(complete.incomplete).toBe(false);
    mocks.pendingFindFirst.mockResolvedValue({ enqueuedAt: new Date() });
    const incomplete = await getOrganizationUsageSummary('user-a', 'org-a');
    expect(incomplete.incomplete).toBe(true);
    expect(incomplete.meters.find((meter) => meter.key === 'public_page_view')?.quantity).toBeNull();
    // The org total names the website's reason instead of a bare "Unknown".
    expect(incomplete.meters.find((meter) => meter.key === 'public_page_view')?.unavailableReason).toBe('catching_up');
    expect(complete.meters.every((meter) => meter.unavailableReason === null)).toBe(true);
  });
});
