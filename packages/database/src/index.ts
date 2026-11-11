import { createHash } from 'node:crypto';
import { canonicalUsageEventBatch, type FinalizedUsageRecord, type UsageEvent } from '@nibleaf/usage';
import { getDb, type PrismaClient } from './client';
import { Prisma } from './generated/client';
import { keys } from './keys';

export * from './generated/client';

// Persist the Prisma client across hot reloads in development.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? getDb({ connectionString: keys().POSTGRES_URL });

export const markUsageStoragePending = async (input: { id: string; partitionId: string; projectId: string; events: UsageEvent[] }) => {
  const enqueuedAt = new Date();
  const events = canonicalUsageEventBatch(input.events);
  const first = events[0];
  if (!first || first.tenantId !== input.partitionId || first.projectId !== input.projectId) {
    throw new Error('Usage ingestion checkpoint scope is invalid.');
  }
  const occurredAt = events.map((event) => new Date(event.occurredAt).getTime());
  const payloadDigest = createHash('sha256')
    .update(
      JSON.stringify(
        events.map((event) => ({
          eventId: event.eventId,
          schemaVersion: event.schemaVersion,
          occurredAt: event.occurredAt,
          tenantId: event.tenantId,
          projectId: event.projectId,
          meterKey: event.meterKey,
          quantity: event.quantity,
          kind: event.kind,
          correctionOfEventId: event.correctionOfEventId,
          source: event.source,
        })),
      ),
    )
    .digest('hex');
  return prisma.$transaction(async (tx) => {
    const projects = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "project" WHERE "id" = ${input.projectId} AND "dataTenantId" = ${input.partitionId} FOR UPDATE`,
    );
    if (!projects[0]) throw new Error('Usage ingestion project scope is invalid.');
    const existing = await tx.usageIngestCheckpoint.findUnique({
      where: { id: input.id },
      select: { partitionId: true, payloadDigest: true, projectId: true, writtenAt: true },
    });
    if (existing && (existing.partitionId !== input.partitionId || existing.projectId !== input.projectId)) {
      throw new Error('Usage ingestion checkpoint scope collision.');
    }
    if (existing && existing.payloadDigest !== payloadDigest) throw new Error('Usage ingestion checkpoint payload collision.');
    const existingMarker = await tx.usageStorageMarker.findUnique({
      where: { partitionId: input.partitionId },
      select: { deletionPendingAt: true },
    });
    if (existingMarker?.deletionPendingAt && (!existing || existing.writtenAt)) {
      throw new Error('Usage ingestion is fenced for tenant deletion.');
    }
    const marker = await tx.usageStorageMarker.upsert({
      where: { partitionId: input.partitionId },
      create: {
        partitionId: input.partitionId,
        organizationId: input.partitionId,
        projectId: input.projectId,
        firstEnqueuedAt: enqueuedAt,
        lastEnqueuedAt: enqueuedAt,
      },
      update: { lastEnqueuedAt: enqueuedAt },
      select: { partitionId: true },
    });
    const checkpoint =
      existing ??
      (await tx.usageIngestCheckpoint.create({
        data: {
          id: input.id,
          partitionId: input.partitionId,
          organizationId: input.partitionId,
          projectId: input.projectId,
          firstOccurredAt: new Date(Math.min(...occurredAt)),
          lastOccurredAt: new Date(Math.max(...occurredAt)),
          events,
          payloadDigest,
          enqueuedAt,
        },
        select: { partitionId: true, payloadDigest: true, projectId: true, writtenAt: true },
      }));
    return { marker, checkpoint };
  });
};

export const markUsageStorageQueued = async (id: string, partitionId: string) =>
  prisma.usageIngestCheckpoint.updateMany({
    where: { id, partitionId, writtenAt: null },
    data: { lastQueuedAt: new Date(), enqueueAttemptCount: { increment: 1 } },
  });

/** Durable evidence that an analytics envelope may reach ClickHouse. This
 * shares the deletion fence but stores no event, query, identity, or payload. */
export const markAnalyticsStoragePending = async (partitionId: string, projectId: string) => {
  const enqueuedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const projects = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "project" WHERE "id" = ${projectId} AND "dataTenantId" = ${partitionId} FOR UPDATE`,
    );
    if (projects.length === 0) return { accepted: false as const };
    const marker = await tx.usageStorageMarker.findUnique({ where: { partitionId }, select: { deletionPendingAt: true } });
    if (marker?.deletionPendingAt) return { accepted: false as const };
    await tx.usageStorageMarker.upsert({
      where: { partitionId },
      create: { partitionId, organizationId: partitionId, projectId, firstEnqueuedAt: enqueuedAt, lastEnqueuedAt: enqueuedAt },
      update: { lastEnqueuedAt: enqueuedAt },
      select: { partitionId: true },
    });
    return { accepted: true as const };
  });
};

/** Fence a partition/project before ClickHouse privacy erasure. Project-row
 * locking serializes this with checkpoint creation so no new batch can race the
 * fence. Existing pending receipts remain drainable and make deletion retry. */
export const beginUsageDeletion = async (partitionId: string, projectId: string) =>
  prisma.$transaction(async (tx) => {
    // PostgreSQL lock functions return void, which the Prisma adapter cannot decode.
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${partitionId}, 904711))::text`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "project" WHERE "id" = ${projectId} AND "dataTenantId" = ${partitionId} FOR UPDATE`);
    const project = await tx.project.findFirst({ where: { id: projectId, dataTenantId: partitionId }, select: { id: true } });
    if (!project) return { exists: false as const, hadStorageMarker: false, pendingCount: 0 };
    const existingMarker = await tx.usageStorageMarker.findUnique({ where: { partitionId }, select: { partitionId: true } });
    const now = new Date();
    await tx.usageStorageMarker.upsert({
      where: { partitionId },
      create: { partitionId, organizationId: partitionId, projectId, firstEnqueuedAt: now, lastEnqueuedAt: now, deletionPendingAt: now },
      update: { deletionPendingAt: now },
      select: { partitionId: true },
    });
    const pendingCount = await tx.usageIngestCheckpoint.count({ where: { partitionId, projectId, writtenAt: null } });
    return { exists: true as const, hadStorageMarker: existingMarker !== null, pendingCount };
  });

/** Concurrent analytics inserts share an advisory lock; deletion takes its
 * exclusive counterpart before setting the fence. This closes the gap between
 * a project check and ClickHouse insertion without serializing normal writes. */
export const runWithTenantAnalyticsWriteFence = async <T>(
  partitionId: string,
  projectId: string,
  checkpointId: string | null,
  action: () => Promise<T>,
) =>
  prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${partitionId}, 904711))::text`);
      const [project, marker, checkpoint] = await Promise.all([
        tx.project.findFirst({ where: { id: projectId, dataTenantId: partitionId }, select: { id: true } }),
        tx.usageStorageMarker.findUnique({ where: { partitionId }, select: { deletionPendingAt: true } }),
        checkpointId
          ? tx.usageIngestCheckpoint.findUnique({
              where: { id: checkpointId },
              select: { partitionId: true, projectId: true, writtenAt: true },
            })
          : Promise.resolve(null),
      ]);
      const drainable = checkpoint?.partitionId === partitionId && checkpoint.projectId === projectId && checkpoint.writtenAt === null;
      if (!project || (marker?.deletionPendingAt && !drainable)) return { accepted: false as const, value: null };
      return { accepted: true as const, value: await action() };
    },
    { timeout: 30_000 },
  );

/** Mark a content-free ingestion receipt drained only after ClickHouse accepts
 * the idempotent fact batch. A missing row is valid after tenant deletion. */
export const markUsageStorageDrained = async (id: string, partitionId: string) => {
  const writtenAt = new Date();
  return prisma.$transaction([
    prisma.usageIngestCheckpoint.updateMany({ where: { id, partitionId, writtenAt: null }, data: { writtenAt } }),
    prisma.usageStorageMarker.updateMany({ where: { partitionId }, data: { lastWrittenAt: writtenAt } }),
  ]);
};

/** Persist provider retries without changing accepted reconciliation identity.
 * Billing ownership is resolved now; organizationId retains the source partition. */
export const markUsageProviderAttempt = async (provider: string, record: FinalizedUsageRecord & { projectId: string }) =>
  prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirstOrThrow({
      where: { id: record.projectId, dataTenantId: record.tenantId },
      select: { id: true, organizationId: true },
    });
    return tx.usageProviderCheckpoint.upsert({
      where: { reconciliationId: record.reconciliationId },
      create: {
        organizationId: record.tenantId,
        projectId: project.id,
        billingOrganizationId: project.organizationId,
        provider,
        reconciliationId: record.reconciliationId,
        meterKey: record.meterKey,
        periodStart: new Date(record.periodStart),
        periodEnd: new Date(record.periodEndExclusive),
        quantity: record.quantity,
        attemptCount: 1,
        lastAttemptAt: new Date(),
      },
      update: { attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    });
  });

/** The plan columns every capability decision needs (see
 * `@nibleaf/shared/plan-policy`). One select, so publish, public delivery and
 * the worker load exactly what settings evaluate. */
export const deliveryPlanSelect = {
  key: true,
  active: true,
  entitlements: { select: { capabilityKey: true, enabled: true, meter: { select: { active: true } } } },
} satisfies Prisma.UsagePlanSelect;

/** The canonical default plan (`DEFAULT_PLAN_KEY` in @nibleaf/shared/plan-policy)
 * with its real configuration; null when it does not exist. */
export const loadDefaultDeliveryPlan = (db: Pick<Prisma.TransactionClient, 'usagePlan'> = prisma) =>
  db.usagePlan.findUnique({ where: { key: 'free' }, select: deliveryPlanSelect });

/** Usage owns default plan provisioning. Product creation paths call this in
 * the same transaction as the organization; add-ons and payment adapters never
 * write plan state. The free plan has no invented quotas or payment metadata. */
export const assignDefaultUsagePlan = async (tx: Prisma.TransactionClient, organizationId: string) => {
  const plan = await tx.usagePlan.upsert({
    where: { key: 'free' },
    create: { key: 'free', name: 'Free', version: 1, active: true },
    update: {},
    select: { id: true },
  });
  return tx.organizationUsagePlan.upsert({
    where: { organizationId },
    create: { organizationId, planId: plan.id, status: 'active' },
    update: {},
    select: { organizationId: true, planId: true },
  });
};

if (keys().NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
