import type { PublishDeploymentJobData } from '@nibleaf/bullmq/jobs/publish';
import { prisma } from '@nibleaf/database';

/** Deployment receipts are replay-safe; source attribution belongs only to the
 * first successful manual publish per author and project. Source rows remain
 * anonymous, and are committed with the canonical marker or not at all. */
export async function recordPublishReady(
  job: Pick<PublishDeploymentJobData, 'deploymentId' | 'projectId' | 'auto' | 'firstPublishAttribution'>,
  ready: { createdById: string | null; version: number; completedAt: Date | null },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const manual = job.auto === false && ready.createdById !== null;
    const previous = manual
      ? await tx.platformEvent.findFirst({
          where: {
            type: 'publish_ready',
            userId: ready.createdById,
            projectId: job.projectId,
            metadata: { path: ['auto'], equals: false },
            NOT: { id: `publish-ready:${job.deploymentId}` },
          },
          select: { id: true },
        })
      : null;
    await tx.platformEvent.createMany({
      data: {
        id: `publish-ready:${job.deploymentId}`,
        type: 'publish_ready',
        userId: ready.createdById,
        projectId: job.projectId,
        metadata: { auto: !manual, version: ready.version },
        ...(ready.completedAt ? { createdAt: ready.completedAt } : {}),
      },
      skipDuplicates: true,
    });
    if (!manual || previous) return;
    const first = await tx.platformEvent.createMany({
      data: {
        id: `first-manual-publish:${ready.createdById}:${job.projectId}`,
        type: 'first_manual_publish_ready',
        userId: ready.createdById,
        projectId: job.projectId,
        ...(ready.completedAt ? { createdAt: ready.completedAt } : {}),
      },
      skipDuplicates: true,
    });
    if (first.count && job.firstPublishAttribution) {
      await tx.platformEvent.create({
        data: {
          type: 'publish_ready',
          metadata: { ...job.firstPublishAttribution },
          ...(ready.completedAt ? { createdAt: ready.completedAt } : {}),
        },
      });
    }
  });
}
