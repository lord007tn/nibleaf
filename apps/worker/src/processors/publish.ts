import type { PublishDeploymentJobData } from '@midad/bullmq/jobs/publish';
import { prisma } from '@midad/database';
import { createLogger } from '@midad/logger';
import { buildSnapshot } from '@midad/shared/site';
import type { Job } from 'bullmq';
import { notifyDeployment } from '../lib/notify';

const log = createLogger({ processor: 'publish' });

const siteUrlFor = (projectId: string): string | undefined =>
  process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/sites/${projectId}` : undefined;

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
      include: { languages: { orderBy: { position: 'asc' } }, branches: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } },
    });
    if (!project) {
      throw new Error(`project ${projectId} not found`);
    }
    // Publish every branch as an addressable docs version. This keeps v1 live
    // while v2 is being authored, and visitors can switch versions on the site.
    const branchIds = project.branches.map((branch) => branch.id);
    const pages = await prisma.page.findMany({
      where: { projectId, ...(branchIds.length > 0 ? { branchId: { in: branchIds } } : {}) },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { language: { select: { code: true } }, branch: { select: { id: true, name: true, isDefault: true } } },
    });
    const pageRows = pages.map(({ language, ...page }) => ({ ...page, languageCode: language?.code }));
    const snapshot = buildSnapshot(project, pageRows, new Date().toISOString());
    const pageCount = pages.filter((page) => page.kind === 'PAGE').length;

    const ready = await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'READY', snapshot: snapshot as unknown as object, pagesCount: pageCount, completedAt: new Date() },
    });
    log.info({ deploymentId, pageCount }, 'deployment ready');
    await notifyDeployment({ projectId, projectName: project.name, version: ready.version, outcome: 'ready', siteUrl: siteUrlFor(projectId) });
    return { pages: pages.length };
  } catch (error) {
    const failed = await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) },
    });
    const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    await notifyDeployment({
      projectId,
      projectName: proj?.name ?? 'Your site',
      version: failed.version,
      outcome: 'failed',
      error: failed.error ?? undefined,
    });
    throw error;
  }
}
