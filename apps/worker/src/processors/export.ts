import { createHash } from 'node:crypto';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import type { ExportJobData, ExportJobName } from '@nibleaf/bullmq/jobs/export';
import { type ExportFormat, type ExportSchedule, Prisma, prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { exportScheduleSlotKey, nextExportRunAt } from '@nibleaf/shared/export-schedule';
import type { SiteSnapshot } from '@nibleaf/shared/site';
import { deleteObject, deletePrefix, getObjectStream, putObject } from '@nibleaf/storage';
import type { Job } from 'bullmq';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright-core';
import { env } from '../env';
import { expiredRunIds, isFinalExportAttempt } from '../exports/lifecycle';
import {
  type ExportAsset,
  type ExportAssetManifestItem,
  type RenderedArtifact,
  renderMarkdownZip,
  renderPdfHtml,
  renderStaticHtml,
  selectPublishedAssets,
} from '../exports/render';
import { trackExportLifecycle } from '../lib/export-analytics';

const log = createLogger({ processor: 'export' });

class ExportCancelledError extends Error {}

const checkCancelled = async (exportJobId: string): Promise<void> => {
  const job = await prisma.exportJob.findUnique({ where: { id: exportJobId }, select: { cancelRequestedAt: true, status: true } });
  if (!job || job.cancelRequestedAt || job.status === 'CANCELLED') throw new ExportCancelledError('Export cancelled.');
};

const streamBytes = async (key: string, maxBytes: number): Promise<Uint8Array> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of await getObjectStream(key)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maxBytes) throw new Error(`Export assets exceed the ${env.EXPORT_MAX_ASSET_BYTES}-byte limit.`);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
};

/** Only package objects referenced by the immutable published snapshot. Draft-
 * only uploads are deliberately excluded from static output. */
const loadReferencedAssets = async (snapshot: SiteSnapshot, manifest: ExportAssetManifestItem[], exportJobId: string): Promise<ExportAsset[]> => {
  const referenced = selectPublishedAssets(snapshot, manifest, env.EXPORT_MAX_ASSET_BYTES);
  const assets: ExportAsset[] = [];
  let remaining = env.EXPORT_MAX_ASSET_BYTES;
  for (const asset of referenced) {
    await checkCancelled(exportJobId);
    if (asset.size > remaining) throw new Error(`Export assets exceed the ${env.EXPORT_MAX_ASSET_BYTES}-byte limit.`);
    const bytes = await streamBytes(asset.key, remaining);
    remaining -= bytes.byteLength;
    assets.push({ ...asset, bytes });
  }
  return assets;
};

const renderPdf = async (snapshot: SiteSnapshot, assets: ExportAsset[]): Promise<RenderedArtifact> => {
  const browser = await chromium.launch({
    executablePath: env.EXPORT_CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    // Prevent published Markdown from turning PDF rendering into an SSRF
    // primitive. All approved project assets are embedded as data URLs.
    await page.route('**/*', (route) => {
      const protocol = new URL(route.request().url()).protocol;
      return ['about:', 'data:'].includes(protocol) ? route.continue() : route.abort();
    });
    await page.setContent(renderPdfHtml(snapshot, assets), { waitUntil: 'load' });
    const browserBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:8px;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    const document = await PDFDocument.load(browserBytes);
    document.setTitle(snapshot.project.name);
    document.setAuthor('Nibleaf');
    document.setSubject(snapshot.project.description ?? 'Published documentation export');
    document.setProducer('Nibleaf');
    document.setCreator('Nibleaf export worker');
    document.setCreationDate(new Date(snapshot.generatedAt));
    document.setKeywords(snapshot.project.languages.map((language) => language.code));
    const bytes = await document.save();
    return { bytes, contentType: 'application/pdf', extension: 'pdf' };
  } finally {
    await browser.close();
  }
};

const rendererFor = async (format: ExportFormat, snapshot: SiteSnapshot, assets: ExportAsset[]): Promise<RenderedArtifact> => {
  if (format === 'MARKDOWN') return renderMarkdownZip(snapshot, assets);
  if (format === 'STATIC_HTML') return renderStaticHtml(snapshot, assets);
  return renderPdf(snapshot, assets);
};

const fileLabel = (format: ExportFormat): string => (format === 'MARKDOWN' ? 'markdown' : format === 'STATIC_HTML' ? 'static-html' : 'pdf');

const enforceScheduleRetention = async (scheduleId: string): Promise<void> => {
  const schedule = await prisma.exportSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) return;
  const runs = await prisma.exportJob.findMany({
    where: { scheduleId, status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] } },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: { artifacts: true },
  });
  const expiredIds = new Set(expiredRunIds(runs, schedule.retentionCount, schedule.retentionDays));
  const expired = runs.filter((run) => expiredIds.has(run.id));
  for (const job of expired) {
    await Promise.allSettled(job.artifacts.map((artifact) => deleteObject(artifact.storageKey)));
    await prisma.exportJob.delete({ where: { id: job.id } });
  }
};

const renderExport = async (bullJob: Job<ExportJobData>): Promise<{ artifacts: number }> => {
  if (!('exportJobId' in bullJob.data)) throw new Error('render-export requires exportJobId');
  const exportJobId = bullJob.data.exportJobId;
  const row = await prisma.exportJob.findUnique({ where: { id: exportJobId }, include: { snapshot: true } });
  if (!row) throw new Error(`Export job ${exportJobId} not found.`);
  if (row.status === 'SUCCEEDED' || row.status === 'CANCELLED') return { artifacts: 0 };
  await checkCancelled(exportJobId);
  await prisma.exportJob.update({
    where: { id: exportJobId },
    data: { status: 'RUNNING', startedAt: row.startedAt ?? new Date(), attempts: { increment: 1 }, error: null },
  });
  await trackExportLifecycle(row.projectId, row.id, { name: 'export_started', operationId: row.id, itemCount: row.formats.length });
  const snapshot = row.snapshot.snapshot as unknown as SiteSnapshot;
  try {
    const assets = await loadReferencedAssets(snapshot, row.snapshot.assets as unknown as ExportAssetManifestItem[], exportJobId);
    for (const format of row.formats) {
      await checkCancelled(exportJobId);
      const artifact = await rendererFor(format, snapshot, assets);
      await checkCancelled(exportJobId);
      const label = fileLabel(format);
      const fileName = `${snapshot.project.slug}-v${row.snapshot.deploymentVersion}-${label}.${artifact.extension}`;
      const storageKey = `projects/${row.projectId}/exports/${row.id}/${fileName}`;
      await putObject(storageKey, artifact.bytes, artifact.contentType);
      await prisma.exportArtifact.upsert({
        where: { jobId_format: { jobId: row.id, format } },
        create: {
          jobId: row.id,
          format,
          storageKey,
          fileName,
          contentType: artifact.contentType,
          size: artifact.bytes.byteLength,
          checksum: createHash('sha256').update(artifact.bytes).digest('hex'),
        },
        update: {
          storageKey,
          fileName,
          contentType: artifact.contentType,
          size: artifact.bytes.byteLength,
          checksum: createHash('sha256').update(artifact.bytes).digest('hex'),
        },
      });
    }
    await prisma.exportJob.update({ where: { id: row.id }, data: { status: 'SUCCEEDED', completedAt: new Date(), error: null } });
    await trackExportLifecycle(row.projectId, row.id, { name: 'export_completed', operationId: row.id, itemCount: row.formats.length });
    await prisma.platformEvent.create({
      data: { type: 'export_succeeded', userId: row.createdById, projectId: row.projectId, metadata: { jobId: row.id, formats: row.formats } },
    });
    if (row.createdById)
      await prisma.notification.create({
        data: {
          userId: row.createdById,
          projectId: row.projectId,
          type: 'export_ready',
          title: 'Your export is ready',
          body: `${row.formats.length} format(s) are ready to download.`,
          href: `/app/projects/${row.projectId}/settings?section=exports`,
        },
      });
    if (row.scheduleId) await enforceScheduleRetention(row.scheduleId);
    return { artifacts: row.formats.length };
  } catch (error) {
    if (error instanceof ExportCancelledError) {
      await deletePrefix(`projects/${row.projectId}/exports/${row.id}/`).catch(() => undefined);
      await prisma.exportJob.update({ where: { id: row.id }, data: { status: 'CANCELLED', completedAt: new Date(), error: null } });
      await trackExportLifecycle(row.projectId, row.id, { name: 'export_cancelled', operationId: row.id });
      return { artifacts: 0 };
    }
    const isFinalAttempt = isFinalExportAttempt(bullJob.attemptsMade, bullJob.opts.attempts);
    if (isFinalAttempt) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
      await prisma.exportJob.update({ where: { id: row.id }, data: { status: 'FAILED', completedAt: new Date(), error: message } });
      await trackExportLifecycle(row.projectId, row.id, { name: 'export_failed', operationId: row.id, outcomeReason: 'render_failed' });
      await prisma.platformEvent.create({
        data: { type: 'export_failed', userId: row.createdById, projectId: row.projectId, metadata: { jobId: row.id, attempts: row.attempts + 1 } },
      });
      if (row.scheduleId) await prisma.exportSchedule.update({ where: { id: row.scheduleId }, data: { lastError: message } }).catch(() => undefined);
      if (row.createdById)
        await prisma.notification.create({
          data: {
            userId: row.createdById,
            projectId: row.projectId,
            type: 'export_failed',
            title: 'Export failed',
            body: message,
            href: `/app/projects/${row.projectId}/settings?section=exports`,
          },
        });
    }
    throw error;
  }
};

const createScheduledRun = async (schedule: ExportSchedule, slot: Date) => {
  // A schedule may be disabled or deleted after the dispatcher selected it.
  // Recheck immediately before snapshot/job creation to close that race.
  const current = await prisma.exportSchedule.findUnique({ where: { id: schedule.id }, select: { enabled: true } });
  if (!current?.enabled) return;
  const deployment = await prisma.deployment.findFirst({
    where: { projectId: schedule.projectId, status: 'READY', snapshot: { not: Prisma.DbNull } },
    orderBy: { version: 'desc' },
  });
  const nextRunAt = nextExportRunAt(schedule, slot);
  if (!deployment?.snapshot) {
    await prisma.exportSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt, lastRunAt: slot, lastError: 'No published revision is available.' },
    });
    return;
  }
  const contentBytes = Buffer.byteLength(JSON.stringify(deployment.snapshot));
  if (deployment.pagesCount > env.EXPORT_MAX_PAGES || contentBytes > env.EXPORT_MAX_SNAPSHOT_BYTES) {
    await prisma.exportSchedule.update({
      where: { id: schedule.id },
      data: {
        nextRunAt,
        lastRunAt: slot,
        lastError: `Published revision exceeds export limits (${deployment.pagesCount} pages, ${contentBytes} bytes).`,
      },
    });
    return;
  }
  const assets = await prisma.asset.findMany({
    where: { projectId: schedule.projectId },
    select: { key: true, url: true, contentType: true, size: true },
  });
  const idempotencyKey = exportScheduleSlotKey(schedule.id, slot);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const snapshot = await tx.exportSnapshot.create({
        data: {
          projectId: schedule.projectId,
          deploymentId: deployment.id,
          deploymentVersion: deployment.version,
          snapshot: deployment.snapshot as Prisma.InputJsonValue,
          assets: assets as unknown as Prisma.InputJsonValue,
          pagesCount: deployment.pagesCount,
          contentBytes,
        },
      });
      const job = await tx.exportJob.create({
        data: {
          projectId: schedule.projectId,
          snapshotId: snapshot.id,
          scheduleId: schedule.id,
          formats: schedule.formats,
          trigger: 'SCHEDULED',
          idempotencyKey,
          createdById: schedule.createdById,
          expiresAt: new Date(slot.getTime() + schedule.retentionDays * 86_400_000),
        },
      });
      await tx.exportSchedule.update({ where: { id: schedule.id }, data: { nextRunAt, lastRunAt: slot, lastError: null } });
      return job;
    });
    await createJob(QueueNames.EXPORT, { name: 'render-export', data: { exportJobId: created.id } }, { jobId: `export-${created.id}` });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.exportJob.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (existing)
        await createJob(QueueNames.EXPORT, { name: 'render-export', data: { exportJobId: existing.id } }, { jobId: `export-${existing.id}` });
      await prisma.exportSchedule.update({ where: { id: schedule.id }, data: { nextRunAt, lastRunAt: slot } });
      return;
    }
    throw error;
  }
};

const dispatchSchedules = async (): Promise<{ dispatched: number }> => {
  const now = new Date();
  // Reconcile database rows left pending if Redis was unavailable after their
  // transaction committed. BullMQ job IDs make this safe on every poll.
  const pending = await prisma.exportJob.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 100, select: { id: true } });
  await Promise.all(
    pending.map((row) => createJob(QueueNames.EXPORT, { name: 'render-export', data: { exportJobId: row.id } }, { jobId: `export-${row.id}` })),
  );
  const schedules = await prisma.exportSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: 100,
  });
  for (const schedule of schedules) await createScheduledRun(schedule, schedule.nextRunAt ?? now);
  return { dispatched: schedules.length };
};

const cleanupExpired = async (): Promise<{ deleted: number }> => {
  const expired = await prisma.exportJob.findMany({
    where: { expiresAt: { lte: new Date() }, status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] } },
    include: { artifacts: true },
    take: 500,
  });
  for (const job of expired) {
    await Promise.allSettled(job.artifacts.map((artifact) => deleteObject(artifact.storageKey)));
    await prisma.exportJob.delete({ where: { id: job.id } });
  }
  await prisma.exportSnapshot.deleteMany({ where: { jobs: { none: {} }, createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
  return { deleted: expired.length };
};

export const handleExportJobs = async (job: Job<ExportJobData, unknown, ExportJobName>) => {
  log.info({ name: job.name, jobId: job.id }, 'processing export job');
  if (job.name === 'render-export') return renderExport(job);
  if (job.name === 'dispatch-export-schedules') return dispatchSchedules();
  return cleanupExpired();
};
