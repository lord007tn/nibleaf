import { closeClickHouseClients, insertAnalyticsEvents } from '../src/client';
import { deterministicAnalyticsEventId } from '../src/events';
import { deleteProjectAnalytics } from '../src/privacy';
import { queryProjectAnalytics } from '../src/queries';
import { fixedAnalyticsEvent } from '../src/testing';

const count = Math.min(100_000, Math.max(1, Number(process.argv[2] ?? 10_000)));
const tenantId = 'benchmark-tenant';
const projectId = `benchmark-${Date.now()}`;
const now = Date.now();
const events = Array.from({ length: count }, (_, index) =>
  fixedAnalyticsEvent({
    eventId: deterministicAnalyticsEventId(`${projectId}:${index}`),
    tenantId,
    projectId,
    siteId: projectId,
    occurredAt: new Date(now - (index % 30) * 86_400_000).toISOString(),
    receivedAt: new Date(now).toISOString(),
    sessionHash:
      index % 5 === 0
        ? null
        : deterministicAnalyticsEventId(`session:${index % 2000}`)
            .replaceAll('-', '')
            .padEnd(64, '0'),
    payload: { name: 'page_view', path: `docs/page-${index % 250}`, language: index % 10 === 0 ? 'ar' : 'en' },
  }),
);

try {
  const insertStarted = performance.now();
  await insertAnalyticsEvents(events);
  const insertMs = Math.round(performance.now() - insertStarted);
  const queryStarted = performance.now();
  const overview = await queryProjectAnalytics(tenantId, projectId, '30d', 'UTC');
  const queryMs = Math.round(performance.now() - queryStarted);
  if (overview.availability !== 'complete' || overview.totalViews !== count) {
    throw new Error(`Representative verification failed: availability=${overview.availability}, views=${overview.totalViews}, expected=${count}`);
  }
  process.stdout.write(`${JSON.stringify({ events: count, insertMs, queryMs, verifiedViews: overview.totalViews })}\n`);
} finally {
  await deleteProjectAnalytics(tenantId, projectId).catch(() => undefined);
  await closeClickHouseClients();
}
