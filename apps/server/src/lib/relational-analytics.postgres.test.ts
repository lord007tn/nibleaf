import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { relationalInterval, relationalViewSummary } from './relational-analytics';

describe.skipIf(process.env.ANALYTICS_POSTGRES !== '1')('relational analytics SQL boundaries', () => {
  let db: typeof import('@nibleaf/database');
  let actions: typeof import('../actions/analytics');
  const id = `analytics-${randomUUID()}`;
  const other = `${id}-other`;
  const userId = `${id}-user`;
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    actions = await import('../actions/analytics');
    await db.prisma.organization.createMany({ data: [id, other].map((orgId) => ({ id: orgId, name: orgId })) });
    await db.prisma.user.create({ data: { id: userId, name: 'Synthetic analyst', email: `${id}@example.invalid` } });
    await db.prisma.member.createMany({ data: [id, other].map((organizationId) => ({ organizationId, userId, role: 'owner', orgRole: 'owner' })) });
    await db.prisma.project.createMany({
      data: [id, other].map((projectId) => ({ id: projectId, organizationId: projectId, name: projectId, slug: projectId })),
    });
  }, 120_000);
  afterAll(async () => {
    vi.useRealTimers();
    await db?.prisma.project.deleteMany({ where: { organizationId: { in: [id, other] } } });
    await db?.prisma.organization.deleteMany({ where: { id: { in: [id, other] } } });
    await db?.prisma.user.deleteMany({ where: { id: userId } });
    await db?.prisma.$disconnect();
  });

  it.each(['24h', '7d', '30d', '90d'] as const)('includes both partial edges for %s in UTC, Berlin DST and Riyadh', async (range) => {
    for (const now of ['2026-03-29T12:30:00Z', '2026-10-25T12:30:00Z', '2026-04-01T22:30:00Z']) {
      for (const timezone of ['UTC', 'Europe/Berlin', 'Asia/Riyadh']) {
        const interval = relationalInterval(range, timezone, new Date(now));
        await db.prisma.analyticsEvent.deleteMany({ where: { projectId: id } });
        await db.prisma.analyticsEvent.createMany({
          data: [
            { createdAt: interval.since, sessionId: 'one' },
            { createdAt: new Date(interval.until.getTime() - 1), sessionId: 'one' },
            { createdAt: new Date(interval.until.getTime() - 1000), sessionId: null },
            { createdAt: new Date(interval.since.getTime() - 1), sessionId: 'outside' },
            { createdAt: interval.previousSince, sessionId: 'previous-edge' },
            { createdAt: new Date(interval.previousSince.getTime() - 1), sessionId: 'before-previous' },
            { createdAt: interval.until, sessionId: 'future' },
          ].map((event) => ({ ...event, projectId: id, type: 'pageview' })),
        });
        const result = await relationalViewSummary([id], interval);
        expect(result.totalViews).toBe(3);
        // The equal window right before: both of its edges, nothing older.
        expect(result.previousTotalViews).toBe(2);
        expect(result.uniqueVisitors).toBe(1);
        expect(result.timeseries.reduce((sum, row) => sum + row.views, 0)).toBe(3);
        expect(result.timeseries[0]).toMatchObject({ views: 1 });
        expect(result.timeseries.at(-1)).toMatchObject({ views: 2 });
        expect(result.timeseries).toHaveLength(interval.dates.length);
      }
    }
  });

  it('counts redacted searches and all legacy terms without crossing project scope', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T12:30:00Z'));
    await db.prisma.analyticsEvent.createMany({
      data: [
        ...Array.from({ length: 12 }, (_, index) => ({ projectId: id, query: `legacy-${index}` })),
        ...Array.from({ length: 100 }, () => ({ projectId: id, query: null })),
        { projectId: other, query: 'outside' },
      ].map((event) => ({ ...event, type: 'search', createdAt: new Date('2026-11-08T12:00:00Z') })),
    });
    const project = await actions.getAnalyticsOverview(id, id, '24h', 'Asia/Riyadh');
    const workspace = await actions.getWorkspaceAnalytics(userId, '24h', 'Asia/Riyadh');
    expect(project.searches.total).toBe(112);
    expect(workspace.searches.total).toBe(113);
    expect(project.topSearches).toHaveLength(10);
    vi.useRealTimers();
  });

  it('returns at most 92 buckets and one visitor scalar for 50000 events/sessions', async () => {
    const interval = relationalInterval('90d', 'Europe/Berlin');
    await db.prisma.$executeRaw`INSERT INTO analytics_event (id, "projectId", type, "sessionId", "createdAt")
      SELECT ${id} || '-' || n, ${id}, 'pageview', 'visitor-' || n, ${interval.until}::timestamp - interval '1 minute' FROM generate_series(1, 50000) AS n`;
    const eventReads = vi.spyOn(db.prisma.analyticsEvent, 'findMany');
    const before = process.memoryUsage().heapUsed;
    const summary = await actions.getAnalyticsOverview(id, id, '90d', 'Europe/Berlin');
    const workspace = await actions.getWorkspaceAnalytics(userId, '90d', 'Europe/Berlin');
    expect(workspace.timeseries.length).toBeLessThanOrEqual(92);
    expect(eventReads).not.toHaveBeenCalled();
    eventReads.mockRestore();
    expect(summary.totalViews).toBeGreaterThanOrEqual(50_000);
    expect(summary.uniqueVisitors).toBeGreaterThanOrEqual(50_000);
    expect(summary.timeseries.length).toBeLessThanOrEqual(92);
    expect(JSON.stringify(summary).length).toBeLessThan(7000);
    process.stdout.write(
      `ANALYTICS_AGGREGATION_OBSERVATION ${JSON.stringify({ fixtureEvents: 50_000, resultBuckets: summary.timeseries.length, responseBytes: JSON.stringify(summary).length, observedHeapDelta: process.memoryUsage().heapUsed - before })}\n`,
    );
  }, 60_000);
});
