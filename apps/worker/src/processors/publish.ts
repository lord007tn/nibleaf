import type { PublishDeploymentJobData } from '@plume/bullmq/jobs/publish';
import { prisma } from '@plume/database';
import { createLogger } from '@plume/logger';
import { buildSnapshot } from '@plume/shared/site';
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
      include: { languages: { orderBy: { position: 'asc' } } },
    });
    if (!project) {
      throw new Error(`project ${projectId} not found`);
    }
    // The published site is built from the default ('main') branch only; other
    // branches are isolated drafts. (Fallback to all pages for legacy projects.)
    const defaultBranch = await prisma.branch.findFirst({ where: { projectId, isDefault: true }, select: { id: true } });
    const pages = await prisma.page.findMany({
      where: { projectId, ...(defaultBranch ? { branchId: defaultBranch.id } : {}) },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { language: { select: { code: true } } },
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
