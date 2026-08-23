import { createJob, getJob, QueueNames, removeJob } from '@nibleaf/bullmq';
import { type ExportFormat, Prisma, prisma } from '@nibleaf/database';
import { nextExportRunAt } from '@nibleaf/shared/export-schedule';
import { presignGetUrl } from '@nibleaf/storage';
import type { CreateExportScheduleBody, UpdateExportScheduleBody } from '@nibleaf/validators';
import { env } from '@/env';
import { badRequest, conflict, notFound } from '@/errors';
import { logPlatformEvent } from './platform-events';

const jobInclude = {
  snapshot: { select: { deploymentVersion: true, pagesCount: true, createdAt: true } },
  artifacts: { orderBy: { createdAt: 'asc' as const } },
  schedule: { select: { id: true, name: true } },
};

const assertQuota = async (projectId: string) => {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [active, daily] = await Promise.all([
    prisma.exportJob.count({ where: { projectId, status: { in: ['PENDING', 'RUNNING'] } } }),
    prisma.exportJob.count({ where: { projectId, createdAt: { gte: dayAgo } } }),
  ]);
  if (active >= env.EXPORT_MAX_ACTIVE_PER_PROJECT) throw conflict(`At most ${env.EXPORT_MAX_ACTIVE_PER_PROJECT} exports may run at once.`);
  if (daily >= env.EXPORT_MAX_DAILY_PER_PROJECT) throw conflict(`The daily export limit of ${env.EXPORT_MAX_DAILY_PER_PROJECT} has been reached.`);
};

const createPublishedSnapshot = async (projectId: string) => {
  const deployment = await prisma.deployment.findFirst({
    where: { projectId, status: 'READY', snapshot: { not: Prisma.DbNull } },
    orderBy: { version: 'desc' },
  });
  if (!deployment?.snapshot) throw badRequest('Publish the site before creating an export.');
  const snapshotText = JSON.stringify(deployment.snapshot);
  const contentBytes = Buffer.byteLength(snapshotText);
  if (deployment.pagesCount > env.EXPORT_MAX_PAGES || contentBytes > env.EXPORT_MAX_SNAPSHOT_BYTES) {
    throw badRequest('The published revision is larger than this instance allows.', {
      pages: deployment.pagesCount,
      maxPages: env.EXPORT_MAX_PAGES,
      bytes: contentBytes,
      maxBytes: env.EXPORT_MAX_SNAPSHOT_BYTES,
    });
  }
  const assets = await prisma.asset.findMany({ where: { projectId }, select: { key: true, url: true, contentType: true, size: true } });
  return prisma.exportSnapshot.create({
    data: {
      projectId,
      deploymentId: deployment.id,
      deploymentVersion: deployment.version,
      snapshot: deployment.snapshot,
      assets: assets as unknown as Prisma.InputJsonValue,
      pagesCount: deployment.pagesCount,
      contentBytes,
    },
  });
};

interface QueueExportOptions {
  scheduleId?: string;
  trigger: 'MANUAL' | 'SCHEDULED';
  retentionDays: number;
}

const queueExport = async (projectId: string, userId: string, formats: ExportFormat[], options: QueueExportOptions) => {
  await assertQuota(projectId);
  const snapshot = await createPublishedSnapshot(projectId);
  const job = await prisma.exportJob.create({
    data: {
      projectId,
      snapshotId: snapshot.id,
      formats,
      createdById: userId,
      trigger: options.trigger,
      ...(options.scheduleId ? { scheduleId: options.scheduleId } : {}),
      expiresAt: new Date(Date.now() + options.retentionDays * 86_400_000),
    },
    include: jobInclude,
  });
  try {
    await createJob(QueueNames.EXPORT, { name: 'render-export', data: { exportJobId: job.id } }, { jobId: `export-${job.id}` });
  } catch (error) {
    await prisma.exportJob.update({ where: { id: job.id }, data: { status: 'FAILED', error: 'The export worker queue is unavailable.' } });
    throw error;
  }
  logPlatformEvent('export_queued', {
    userId,
    projectId,
    metadata: {
      jobId: job.id,
      formats,
      deploymentVersion: snapshot.deploymentVersion,
      trigger: options.trigger,
      ...(options.scheduleId ? { scheduleId: options.scheduleId } : {}),
    },
  });
  return job;
};

export const createExport = (projectId: string, userId: string, formats: ExportFormat[]) =>
  queueExport(projectId, userId, formats, { trigger: 'MANUAL', retentionDays: env.EXPORT_MANUAL_RETENTION_DAYS });

export const listExports = (projectId: string) =>
  prisma.exportJob.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 50, include: jobInclude });

export const getExport = async (projectId: string, id: string) => {
  const job = await prisma.exportJob.findFirst({ where: { id, projectId }, include: jobInclude });
  if (!job) throw notFound('export job', { id });
  return job;
};

export const cancelExport = async (projectId: string, id: string, userId: string) => {
  const job = await prisma.exportJob.findFirst({ where: { id, projectId } });
  if (!job) throw notFound('export job', { id });
  if (!['PENDING', 'RUNNING'].includes(job.status)) throw conflict('Only queued or running exports can be cancelled.');
  const queued = await getJob(QueueNames.EXPORT, `export-${id}`);
  const state = queued ? await queued.getState() : null;
  if (state && state !== 'active') await removeJob(QueueNames.EXPORT, `export-${id}`);
  const updated = await prisma.exportJob.update({
    where: { id },
    data: state === 'active' ? { cancelRequestedAt: new Date() } : { status: 'CANCELLED', cancelRequestedAt: new Date(), completedAt: new Date() },
    include: jobInclude,
  });
  logPlatformEvent('export_cancelled', { userId, projectId, metadata: { jobId: id } });
  return updated;
};

export const getExportDownload = async (projectId: string, jobId: string, artifactId: string, userId: string) => {
  const artifact = await prisma.exportArtifact.findFirst({
    where: { id: artifactId, jobId, job: { projectId, status: 'SUCCEEDED' } },
    include: { job: { select: { expiresAt: true } } },
  });
  if (!artifact) throw notFound('export artifact', { artifactId });
  if (artifact.job.expiresAt && artifact.job.expiresAt <= new Date()) throw notFound('export artifact', { artifactId });
  const url = await presignGetUrl({ key: artifact.storageKey, expiresInSeconds: env.EXPORT_DOWNLOAD_TTL_SECONDS });
  logPlatformEvent('export_downloaded', { userId, projectId, metadata: { jobId, artifactId, format: artifact.format } });
  return { url, expiresInSeconds: env.EXPORT_DOWNLOAD_TTL_SECONDS, fileName: artifact.fileName };
};

export const listExportSchedules = (projectId: string) =>
  prisma.exportSchedule.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { jobs: true } } } });

export const createExportSchedule = async (projectId: string, userId: string, body: CreateExportScheduleBody) => {
  const scheduleCount = await prisma.exportSchedule.count({ where: { projectId } });
  if (scheduleCount >= 20) throw conflict('At most 20 archive schedules may be configured per project.');
  const nextRunAt = nextExportRunAt(body, new Date());
  const schedule = await prisma.exportSchedule.create({
    data: {
      projectId,
      createdById: userId,
      name: body.name,
      formats: body.formats,
      cadence: body.cadence,
      timezone: body.timezone,
      hour: body.hour,
      minute: body.minute,
      weekday: body.weekday,
      monthday: body.monthday,
      retentionCount: body.retentionCount,
      retentionDays: body.retentionDays,
      nextRunAt,
    },
  });
  logPlatformEvent('export_schedule_created', { userId, projectId, metadata: { scheduleId: schedule.id } });
  return schedule;
};

export const updateExportSchedule = async (projectId: string, id: string, userId: string, body: UpdateExportScheduleBody) => {
  const existing = await prisma.exportSchedule.findFirst({ where: { id, projectId } });
  if (!existing) throw notFound('export schedule', { id });
  const enabled = body.enabled ?? existing.enabled;
  const updated = await prisma.exportSchedule.update({
    where: { id },
    data: {
      ...body,
      nextRunAt: enabled && (!existing.enabled || !existing.nextRunAt) ? nextExportRunAt(existing, new Date()) : enabled ? existing.nextRunAt : null,
    },
  });
  logPlatformEvent('export_schedule_updated', { userId, projectId, metadata: { scheduleId: id, enabled: updated.enabled } });
  return updated;
};

export const deleteExportSchedule = async (projectId: string, id: string, userId: string) => {
  const deleted = await prisma.exportSchedule.deleteMany({ where: { id, projectId } });
  if (!deleted.count) throw notFound('export schedule', { id });
  logPlatformEvent('export_schedule_deleted', { userId, projectId, metadata: { scheduleId: id } });
  return { id };
};

export const runExportSchedule = async (projectId: string, id: string, userId: string) => {
  const schedule = await prisma.exportSchedule.findFirst({ where: { id, projectId } });
  if (!schedule) throw notFound('export schedule', { id });
  logPlatformEvent('export_schedule_manual_run', { userId, projectId, metadata: { scheduleId: id } });
  return queueExport(projectId, userId, schedule.formats, {
    scheduleId: schedule.id,
    trigger: 'SCHEDULED',
    retentionDays: schedule.retentionDays,
  });
};
