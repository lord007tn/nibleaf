import { createJob, getJob, QueueNames, removeJob } from '@nibleaf/bullmq';
import { ERASE_PROJECT_STORAGE_START_DELAY_MS, eraseProjectStorageJobId } from '@nibleaf/bullmq/jobs/erasure';
import {
  keys as clickHouseKeys,
  clickHouseWritesEnabled,
  deleteProjectAiConversations,
  deleteProjectAnalytics,
  deleteProjectUsage,
} from '@nibleaf/clickhouse';
import { beginUsageDeletion, prisma } from '@nibleaf/database';

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

export class TenantErasureManifestMismatchError extends Error {
  constructor() {
    super('A website outside the deletion manifest belongs to this organization.');
    this.name = 'TenantErasureManifestMismatchError';
  }
}

/**
 * Erase an organization and every website in it (design §6.12). The fence and
 * a fixed website manifest are written atomically first: by the owner's own
 * transaction for an org deletion, or here, under the org row lock, for a
 * caller that has none. Each manifest website is then erased on its own,
 * outside any long transaction, so a retry resumes with whatever is left. A
 * website that is not on the manifest is never erased; it stops the deletion
 * (fenced orgs refuse new websites, so it can only be a bug). The org row goes
 * last, once it holds no website (`project → organization` is Restrict).
 */
export const eraseOrganization = async (organizationId: string) => {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organization WHERE id = ${organizationId} FOR NO KEY UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { deletionStartedAt: true } });
    if (!org || org.deletionStartedAt) return;
    const websites = await tx.project.findMany({ where: { organizationId }, select: { id: true }, orderBy: { id: 'asc' } });
    await tx.organization.update({
      where: { id: organizationId },
      data: { deletionStartedAt: new Date(), deletionWebsiteIds: websites.map((website) => website.id) },
    });
  });
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { deletionWebsiteIds: true } });
  if (!org) return { organizationId };
  const manifest = new Set(org.deletionWebsiteIds);
  const present = await prisma.project.findMany({ where: { organizationId }, select: { id: true }, orderBy: { id: 'asc' } });
  if (present.some((website) => !manifest.has(website.id))) throw new TenantErasureManifestMismatchError();
  for (const website of present) {
    try {
      await eraseProject(website.id);
    } catch (error) {
      // A concurrent retry already erased it.
      if (!(error instanceof TenantErasureProjectNotFoundError)) throw error;
    }
  }
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
