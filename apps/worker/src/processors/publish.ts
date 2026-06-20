import type { PublishDeploymentJobData } from '@plume/bullmq/jobs/publish';
import { prisma } from '@plume/database';
import { createLogger } from '@plume/logger';
import { buildSnapshot } from '@plume/shared/site';
import type { Job } from 'bullmq';

const log = createLogger({ processor: 'publish' });

/**
 * Build an immutable snapshot of the project's docs and mark the deployment
 * READY. The live site and search index are served from this snapshot.
 */
export async function handlePublishJobs(job: Job<PublishDeploymentJobData>): Promise<{ pages: number }> {
  const { deploymentId, projectId } = job.data;
  log.info({ deploymentId, projectId }, 'building deployment');

  await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'BUILDING' } });

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { languages: { orderBy: { position: 'asc' } } },
    });
    if (!project) {
      throw new Error(`project ${projectId} not found`);
    }
    const pages = await prisma.page.findMany({
      where: { projectId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { language: { select: { code: true } } },
    });
    const pageRows = pages.map(({ language, ...page }) => ({ ...page, languageCode: language?.code }));
    const snapshot = buildSnapshot(project, pageRows, new Date().toISOString());
    const pageCount = pages.filter((page) => page.kind === 'PAGE').length;

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'READY', snapshot: snapshot as unknown as object, pagesCount: pageCount, completedAt: new Date() },
    });
    log.info({ deploymentId, pageCount }, 'deployment ready');
    return { pages: pages.length };
  } catch (error) {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
