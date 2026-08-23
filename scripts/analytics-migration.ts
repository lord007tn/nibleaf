import {
  type AnalyticsEventEnvelope,
  type AnalyticsPayload,
  analyticsBackfillEventId,
  buildAnalyticsEvent,
  getClickHouseClient,
  insertAnalyticsEvents,
  keys,
  rebuildProjectAnalyticsRollups,
} from '@nibleaf/clickhouse';
import { prisma } from '@nibleaf/database';
import type { ProjectConfig } from '@nibleaf/validators';

const command = process.argv[2];
const arg = (name: string): string | undefined => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const projectFilter = arg('project');
const batchSize = Math.min(5000, Math.max(1, Number(arg('batch-size') ?? 500)));
const config = keys();

if (!config.ANALYTICS_HASH_SALT) throw new Error('ANALYTICS_HASH_SALT is required for analytics migration tooling.');

const projectContexts = new Map<
  string,
  { organizationId: string; privacy: { visibility: 'private' | 'public'; allowCampaignDimensions: boolean; allowRawPublicSearchQueries: boolean } }
>();

const contextFor = async (projectId: string) => {
  const cached = projectContexts.get(projectId);
  if (cached) return cached;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true, accessMode: true, config: true },
  });
  if (!project) throw new Error(`Project ${projectId} no longer exists.`);
  const projectConfig = project.config as ProjectConfig | null;
  const value = {
    organizationId: project.organizationId,
    privacy: {
      visibility: (project.accessMode === 'PUBLIC' && projectConfig?.visibility !== 'private' ? 'public' : 'private') as 'private' | 'public',
      allowCampaignDimensions: false,
      // A backfill has no historical consent ledger. Raw terms are never copied.
      allowRawPublicSearchQueries: false,
    },
  };
  projectContexts.set(projectId, value);
  return value;
};

const payloadFor = (event: {
  type: string;
  path: string | null;
  referrer: string | null;
  query: string | null;
  language: string | null;
}): AnalyticsPayload => {
  if (event.type === 'search') return { name: 'search_query_submitted', query: event.query ?? undefined, language: event.language ?? undefined };
  if (event.type === 'feedback') {
    return {
      name: 'feedback_submitted',
      path: event.path ?? undefined,
      feedback: event.query === 'not_helpful' ? 'not_helpful' : 'helpful',
      target: 'page',
    };
  }
  return { name: 'page_view', path: event.path ?? undefined, referrer: event.referrer ?? undefined, language: event.language ?? undefined };
};

const backfill = async (): Promise<void> => {
  let cursor: string | undefined = arg('after');
  let migrated = 0;
  for (;;) {
    const rows = await prisma.analyticsEvent.findMany({
      where: projectFilter ? { projectId: projectFilter } : undefined,
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    const envelopes: AnalyticsEventEnvelope[] = [];
    for (const row of rows) {
      const context = await contextFor(row.projectId);
      envelopes.push(
        buildAnalyticsEvent(
          {
            // Current dual writes use the envelope UUID as the relational id.
            // Preserve it so a concurrent/backfill copy deduplicates with the
            // live ClickHouse fact. Older cuid rows receive a stable UUID.
            eventId: analyticsBackfillEventId(row.id),
            occurredAt: row.createdAt.toISOString(),
            consentState: 'unknown',
            sessionId: row.sessionId ?? undefined,
            payload: payloadFor(row),
          },
          {
            tenantId: context.organizationId,
            projectId: row.projectId,
            siteId: row.projectId,
            source: 'backfill',
            country: row.country ?? undefined,
            device: row.device ?? undefined,
            privacy: context.privacy,
            hashSalt: config.ANALYTICS_HASH_SALT,
            receivedAt: row.createdAt,
          },
        ),
      );
    }
    await insertAnalyticsEvents(envelopes);
    migrated += rows.length;
    cursor = rows.at(-1)?.id;
    process.stdout.write(`backfilled=${migrated} cursor=${cursor}\n`);
  }
};

const reconcile = async (): Promise<void> => {
  const projects = projectFilter
    ? await prisma.project.findMany({ where: { id: projectFilter }, select: { id: true, organizationId: true } })
    : await prisma.project.findMany({ select: { id: true, organizationId: true } });
  const client = getClickHouseClient('reader');
  let mismatches = 0;
  for (const project of projects) {
    let cursor: string | undefined;
    let relational = 0;
    let clickhouse = 0;
    for (;;) {
      const rows = await prisma.analyticsEvent.findMany({
        where: { projectId: project.id },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      const expectedIds = rows.map((row) => analyticsBackfillEventId(row.id));
      const result = await client.query({
        query: `SELECT uniqExact(event_id) AS count FROM analytics_events FINAL
          WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String}
            AND event_id IN {event_ids:Array(UUID)}`,
        query_params: { tenant_id: project.organizationId, project_id: project.id, event_ids: expectedIds },
        format: 'JSONEachRow',
      });
      const [row] = await result.json<{ count: string | number }>();
      relational += rows.length;
      clickhouse += Number(row?.count ?? 0);
      cursor = rows.at(-1)?.id;
    }
    const delta = clickhouse - relational;
    if (delta !== 0) mismatches += 1;
    process.stdout.write(`${JSON.stringify({ projectId: project.id, relational, clickhouse, delta })}\n`);
  }
  if (mismatches > 0) process.exitCode = 2;
};

const rollback = async (): Promise<void> => {
  if (!projectFilter || arg('confirm-project') !== projectFilter) {
    throw new Error('Rollback requires --project=<id> and the matching --confirm-project=<id>.');
  }
  const project = await prisma.project.findUnique({ where: { id: projectFilter }, select: { organizationId: true } });
  if (!project) throw new Error(`Project ${projectFilter} not found.`);
  const client = getClickHouseClient('writer');
  await client.command({
    query: `ALTER TABLE analytics_events DELETE
      WHERE tenant_id = {tenant_id:String} AND project_id = {project_id:String} AND source = 'backfill'`,
    query_params: { tenant_id: project.organizationId, project_id: projectFilter },
    clickhouse_settings: { mutations_sync: '1' },
  });
  await rebuildProjectAnalyticsRollups(project.organizationId, projectFilter, client);
  process.stdout.write(`Rolled back backfilled facts for project ${projectFilter}. Live ClickHouse events were preserved.\n`);
};

if (command === 'backfill') await backfill();
else if (command === 'reconcile') await reconcile();
else if (command === 'rollback') await rollback();
else throw new Error('Usage: analytics-migration.ts <backfill|reconcile|rollback> [--project=<id>]');
