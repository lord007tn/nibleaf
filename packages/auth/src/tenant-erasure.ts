import { createJob, getJob, QueueNames, removeJob } from '@nibleaf/bullmq';
import { ERASE_PROJECT_STORAGE_START_DELAY_MS, eraseProjectStorageJobId } from '@nibleaf/bullmq/jobs/erasure';
import {
  keys as clickHouseKeys,
  clickHouseWritesEnabled,
  deleteProjectAiConversations,
  deleteProjectAnalytics,
  deleteProjectUsage,
} from '@nibleaf/clickhouse';
import { beginUsageDeletion, Prisma, prisma } from '@nibleaf/database';

/** BullMQ ignores a new job whose id it still retains, so a retried deletion must
 * clear an exhausted failed job to queue erasure again. A waiting, delayed, or
 * active job is left alone: it already waits for the relational delete. */
const enqueueProjectStorageErasure = async (projectId: string) => {
  const jobId = eraseProjectStorageJobId(projectId);
  const existing = await getJob(QueueNames.ERASURE, jobId);
  if (await existing?.isFailed()) await removeJob(QueueNames.ERASURE, jobId);
  await createJob(QueueNames.ERASURE, { name: 'erase-project-storage', data: { projectId } }, { jobId, delay: ERASE_PROJECT_STORAGE_START_DELAY_MS });
};

export class TenantUsageDeletionPendingError extends Error {
  constructor(readonly pendingCount: number) {
    super('Usage ingestion is still draining.');
    this.name = 'TenantUsageDeletionPendingError';
  }
}

export class TenantErasureProjectNotFoundError extends Error {
  constructor() {
    super('Tenant project not found.');
    this.name = 'TenantErasureProjectNotFoundError';
  }
}

/** Erase exactly one immutable website partition, regardless of its billing org. */
export const eraseProject = async (projectId: string) => {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, organizationId: true, dataTenantId: true } });
  if (!project) throw new TenantErasureProjectNotFoundError();
  const partitionId = project.dataTenantId;
  const deletion = await beginUsageDeletion(partitionId, project.id);
  if (!deletion.exists) throw new TenantErasureProjectNotFoundError();
  if (deletion.pendingCount > 0) throw new TenantUsageDeletionPendingError(deletion.pendingCount);
  if (clickHouseWritesEnabled(clickHouseKeys().ANALYTICS_MODE) || deletion.hadStorageMarker) {
    await Promise.all([
      deleteProjectAiConversations(partitionId, project.id),
      deleteProjectAnalytics(partitionId, project.id),
      deleteProjectUsage(partitionId, project.id),
    ]);
  }
  await enqueueProjectStorageErasure(project.id);
  await createJob(QueueNames.SEARCH, { name: 'delete-project', data: { projectId: project.id } }, { jobId: `search-delete-${project.id}` });
  await prisma.usageProviderCheckpoint.updateMany({
    where: { organizationId: partitionId, OR: [{ projectId: project.id }, { projectId: null }] },
    data: { status: 'deletion_pending', hasError: false },
  });
  await prisma.project.delete({ where: { id: project.id } });
  return { organizationId: project.organizationId, projectId: project.id };
};

/** Persist the fence when the core migration has supplied it. The row lock also
 * supports this branch before that column exists. TODO(core): make the column
 * mandatory after the two PR-1 branches are integrated. */
export const eraseOrganization = async (organizationId: string) => {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; fenced: boolean }>>(Prisma.sql`
      SELECT id, to_jsonb(o) ? 'deletionStartedAt' AS fenced FROM organization o WHERE id = ${organizationId} FOR UPDATE`);
    if (!rows[0]) return;
    if (rows[0].fenced)
      await tx.$executeRaw(Prisma.sql`
      UPDATE organization SET "deletionStartedAt" = COALESCE("deletionStartedAt", now()) WHERE id = ${organizationId}`);
  });
  // Before the core fence lands, hold the org lock through erasure so old code
  // cannot attach a new project between enumeration and the final delete.
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`);
      const projects = await tx.project.findMany({ where: { organizationId }, select: { id: true }, orderBy: { id: 'asc' } });
      for (const project of projects) await eraseProject(project.id);
      await tx.organization.deleteMany({ where: { id: organizationId } });
    },
    { timeout: 120_000 },
  );
  return { organizationId };
};

/** Compatibility for current 1:1 deletion callers. A sibling always survives. */
export const eraseProjectOrganization = async (organizationId: string, expectedProjectId?: string) => {
  if (!expectedProjectId) return eraseOrganization(organizationId);
  const project = await prisma.project.findFirst({ where: { id: expectedProjectId, organizationId }, select: { id: true } });
  if (!project) throw new TenantErasureProjectNotFoundError();
  const wasOnlyWebsite = (await prisma.project.count({ where: { organizationId } })) === 1;
  const result = await eraseProject(project.id);
  if (wasOnlyWebsite) await prisma.organization.deleteMany({ where: { id: organizationId, projects: { none: {} } } });
  return result;
};
