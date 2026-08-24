import { createJob, QueueNames } from '@nibleaf/bullmq';
import { keys as clickHouseKeys, clickHouseWritesEnabled, deleteProjectAnalytics, deleteProjectUsage } from '@nibleaf/clickhouse';
import { beginUsageDeletion, prisma } from '@nibleaf/database';

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

/** Single fail-closed tenant erasure workflow used by product and Better Auth
 * deletion paths. The relational fence prevents post-tombstone usage writes. */
export const eraseProjectOrganization = async (organizationId: string, expectedProjectId?: string) => {
  const project = await prisma.project.findUnique({ where: { organizationId }, select: { id: true } });
  if (!project) {
    const marker = await prisma.usageStorageMarker.findUnique({ where: { organizationId }, select: { organizationId: true } });
    if (marker || expectedProjectId) throw new TenantErasureProjectNotFoundError();
    await prisma.organization.delete({ where: { id: organizationId } });
    return { organizationId, projectId: null };
  }
  if (expectedProjectId && project.id !== expectedProjectId) throw new TenantErasureProjectNotFoundError();

  const deletion = await beginUsageDeletion(organizationId, project.id);
  if (!deletion.exists) throw new TenantErasureProjectNotFoundError();
  if (deletion.pendingCount > 0) throw new TenantUsageDeletionPendingError(deletion.pendingCount);

  if (clickHouseWritesEnabled(clickHouseKeys().ANALYTICS_MODE) || deletion.hadStorageMarker) {
    await Promise.all([deleteProjectAnalytics(organizationId, project.id), deleteProjectUsage(organizationId, project.id)]);
  }
  await createJob(QueueNames.SEARCH, { name: 'delete-project', data: { projectId: project.id } }, { jobId: `search-delete-${project.id}` });
  await prisma.usageProviderCheckpoint.updateMany({
    where: { organizationId },
    data: { status: 'deletion_pending', hasError: false },
  });
  await prisma.organization.delete({ where: { id: organizationId } });
  return { organizationId, projectId: project.id };
};
