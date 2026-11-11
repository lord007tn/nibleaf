import { randomUUID } from 'node:crypto';
import { type AnalyticsJobData, type AnalyticsJobName, analyticsEventJobOptions, analyticsIngestJobId } from '@nibleaf/bullmq/jobs/analytics';
import { closeClickHouseClients, deleteProjectAnalytics, deleteProjectUsage, getClickHouseClient, insertAnalyticsEvents } from '@nibleaf/clickhouse';
import { fixedAnalyticsEvent } from '@nibleaf/clickhouse/testing';
import { beginUsageDeletion, markAnalyticsStoragePending, prisma, runWithTenantAnalyticsWriteFence } from '@nibleaf/database';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ unavailable: false }));
vi.mock('@nibleaf/clickhouse', async (original) => {
  const actual = await original<typeof import('@nibleaf/clickhouse')>();
  return {
    ...actual,
    insertAnalyticsEvents: async (...args: Parameters<typeof actual.insertAnalyticsEvents>) => {
      if (transport.unavailable) throw new Error('Synthetic isolated ClickHouse transport outage');
      return actual.insertAnalyticsEvents(...args);
    },
  };
});

import { handleAnalyticsJobs } from '../processors/analytics';

const integration = process.env.CLICKHOUSE_INTEGRATION === '1' ? describe : describe.skip;
integration('real Redis/Postgres/ClickHouse analytics pipeline', () => {
  const id = randomUUID();
  const tenantId = `analytics-pipeline-${id}`;
  const projectId = `pipeline-${id}`;
  const queueName = `{nibleaf-analytics-test}-pipeline-${id}`;
  const connection = {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
    db: Number(process.env.REDIS_DB),
    maxRetriesPerRequest: null,
    protocol: 2 as const,
  };
  let queue: Queue;
  let events: QueueEvents;
  let worker: Worker<AnalyticsJobData, unknown, AnalyticsJobName>;
  const workerErrors: Error[] = [];

  beforeAll(async () => {
    if (process.env.CLICKHOUSE_DATABASE !== 'nibleaf_analytics_test' || !process.env.POSTGRES_URL?.includes('/nibleaf_analytics_test'))
      throw new Error('Pipeline fixtures require the assigned nibleaf-analytics-test namespace');
    vi.stubEnv('ANALYTICS_MODE', 'clickhouse');
    await prisma.organization.create({ data: { id: tenantId, name: 'Fictional analytics pipeline', slug: tenantId } });
    await prisma.project.create({
      data: { id: projectId, organizationId: tenantId, dataTenantId: tenantId, name: 'Fictional analytics test', slug: projectId },
    });
    queue = new Queue(queueName, { connection });
    events = new QueueEvents(queueName, { connection });
    worker = new Worker<AnalyticsJobData, unknown, AnalyticsJobName>(queueName, (job) => handleAnalyticsJobs(job), { connection, concurrency: 10 });
    worker.on('error', (error) => workerErrors.push(error));
    await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
  }, 60_000);

  afterAll(async () => {
    transport.unavailable = false;
    await worker?.close();
    await events?.close();
    if (queue) {
      await queue.obliterate();
      await queue.close();
    }
    await deleteProjectAnalytics(tenantId, projectId);
    await deleteProjectUsage(tenantId, projectId);
    await prisma.project.deleteMany({ where: { id: projectId, organizationId: tenantId } });
    await prisma.organization.deleteMany({ where: { id: tenantId } });
    await closeClickHouseClients();
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  }, 60_000);

  it.each([60_000, 3_600_000, 86_400_000])(
    'retains an aged %i ms job across storage failure and drains only after replay',
    async (age) => {
      const now = new Date().toISOString();
      const envelope = fixedAnalyticsEvent({ tenantId, projectId, siteId: projectId, eventId: randomUUID(), occurredAt: now, receivedAt: now });
      const jobId = analyticsIngestJobId(envelope);
      transport.unavailable = true;
      const job = await queue.add(
        'track-event',
        { kind: 'track-event', envelope },
        { ...analyticsEventJobOptions, jobId, timestamp: Date.now() - age },
      );
      await expect.poll(() => job.getState(), { timeout: 15_000 }).toBe('delayed');
      expect((await prisma.usageIngestCheckpoint.findUnique({ where: { id: jobId } }))?.writtenAt).toBeNull();
      expect((await queue.getJob(jobId))?.data.envelope.eventId).toBe(envelope.eventId);
      transport.unavailable = false;
      await job.promote();
      expect(await job.waitUntilFinished(events, 15_000)).toEqual({ inserted: 1 });
      expect((await prisma.usageIngestCheckpoint.findUnique({ where: { id: jobId } }))?.writtenAt).toBeInstanceOf(Date);
      const result = await getClickHouseClient().query({
        query: 'SELECT count() AS n FROM analytics_events FINAL WHERE tenant_id = {t:String} AND project_id = {p:String} AND event_id = {e:UUID}',
        query_params: { t: tenantId, p: projectId, e: envelope.eventId },
        format: 'JSONEachRow',
      });
      expect(Number((await result.json<{ n: number }>())[0]?.n)).toBe(1);
      expect(workerErrors).toEqual([]);
    },
    30_000,
  );

  it('serializes erasure against an active write and blocks late Redis replay plus raw transport', async () => {
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = runWithTenantAnalyticsWriteFence(tenantId, projectId, null, async () => {
      entered();
      await finish;
    });
    await started;
    let erased = false;
    const deletion = beginUsageDeletion(tenantId, projectId).then((result) => {
      erased = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(erased).toBe(false);
    release();
    await write;
    expect((await deletion).pendingCount).toBe(0);
    expect(await markAnalyticsStoragePending(tenantId, projectId)).toEqual({ accepted: false });
    await deleteProjectAnalytics(tenantId, projectId);
    const now = new Date().toISOString();
    const envelope = fixedAnalyticsEvent({ tenantId, projectId, siteId: projectId, eventId: randomUUID(), occurredAt: now, receivedAt: now });
    const job = await queue.add(
      'track-event',
      { kind: 'track-event', envelope },
      { ...analyticsEventJobOptions, jobId: analyticsIngestJobId(envelope) },
    );
    expect(await job.waitUntilFinished(events, 15_000)).toEqual({ inserted: 0 });
    await insertAnalyticsEvents([envelope]);
    const result = await getClickHouseClient().query({
      query: 'SELECT count() AS n FROM analytics_events FINAL WHERE tenant_id = {t:String} AND project_id = {p:String}',
      query_params: { t: tenantId, p: projectId },
      format: 'JSONEachRow',
    });
    expect(Number((await result.json<{ n: number }>())[0]?.n)).toBe(0);
  }, 30_000);
});
