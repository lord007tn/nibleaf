import { createJob, QueueNames } from '@nibleaf/bullmq';
import { type EraseProjectStorageJobData, eraseProjectStorageFinalPassJobId } from '@nibleaf/bullmq/jobs/erasure';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { DEFAULT_PRESIGN_EXPIRES_IN_SECONDS, deletePrefix, StorageDeleteError } from '@nibleaf/storage';
import type { Job } from 'bullmq';
import { isFinalExportAttempt } from '../exports/lifecycle';

const log = createLogger({ processor: 'project-storage-erasure' });

/** Time for a PUT that started just before its URL expired, or an export that was
 * already running, to finish. Nothing enforces this as a deadline: the queue lock
 * on an export renews while it runs. It's far longer than either should take. */
const LATE_WRITE_MARGIN_MS = 23 * 60 * 60 * 1000;

/** An upload URL signed just before deletion stays usable for its whole lifetime, so
 * an object can appear after the first pass. One written after the final pass stays. */
export const FINAL_PASS_DELAY_MS = DEFAULT_PRESIGN_EXPIRES_IN_SECONDS * 1000 + LATE_WRITE_MARGIN_MS;

class ProjectStillExistsError extends Error {
  constructor() {
    super('Project still exists; storage erasure waits for relational deletion.');
    this.name = 'ProjectStillExistsError';
  }
}

/** The queue's failure log and stored reason keep this error's message, and a storage
 * backend's own message may name an object. Only an HTTP status survives from one. */
const keyFreeFailure = (error: unknown): Error => {
  if (error instanceof StorageDeleteError || error instanceof ProjectStillExistsError) return error;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null | undefined)?.$metadata?.httpStatusCode;
  return new Error(`Project storage erasure failed${typeof status === 'number' ? ` (HTTP ${status})` : ''}.`);
};

/** Every per-project object (assets, imported assets, export artifacts) lives under this prefix. */
const projectStoragePrefix = (projectId: string): string => {
  if (!projectId || projectId.includes('/')) throw new TypeError('Project storage erasure requires a single-segment project id.');
  return `projects/${projectId}/`;
};

/**
 * Delete all stored objects of a deleted project. Throws while the project row
 * still exists so the job retries until relational erasure commits; repeated
 * runs are no-ops once the prefix is empty.
 */
export const eraseProjectStorage = async (projectId: string): Promise<number> => {
  const prefix = projectStoragePrefix(projectId);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (project) throw new ProjectStillExistsError();
  return deletePrefix(prefix);
};

/** Run one `erase-project-storage` pass. The first successful pass schedules the
 * final one; the final pass never schedules another. */
export const handleProjectStorageErasure = async (job: Job<EraseProjectStorageJobData>) => {
  const { projectId, finalPass = false } = job.data;
  try {
    const storageObjects = await eraseProjectStorage(projectId);
    if (!finalPass) {
      await createJob(
        QueueNames.ERASURE,
        { name: 'erase-project-storage', data: { projectId, finalPass: true } },
        { jobId: eraseProjectStorageFinalPassJobId(projectId), delay: FINAL_PASS_DELAY_MS },
      );
    }
    return { storageObjects, finalPass };
  } catch (error) {
    if (isFinalExportAttempt(job.attemptsMade, job.opts.attempts)) {
      log.error({ projectId, finalPass }, 'project storage erasure used all its attempts; objects may remain');
    }
    throw keyFreeFailure(error);
  }
};
