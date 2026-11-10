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

/**
 * Erase an organization and every website in it. The deletion fence is
 * committed first (org mutations, admissions and new websites refuse a fenced
 * org), then each website is erased on its own, outside any long transaction,
 * so a retry resumes with whatever websites remain. The org row goes last,
 * and only once it holds no website (`project → organization` is Restrict).
 */
export const eraseOrganization = async (organizationId: string) => {
  const fenced = await prisma.organization.updateMany({
    where: { id: organizationId },
    data: { deletionStartedAt: new Date() },
  });
  if (fenced.count === 0) return { organizationId };
  const projects = await prisma.project.findMany({ where: { organizationId }, select: { id: true }, orderBy: { id: 'asc' } });
  for (const project of projects) await eraseProject(project.id);
  await prisma.organization.deleteMany({ where: { id: organizationId, projects: { none: {} } } });
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
