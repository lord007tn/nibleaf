import { createJob, QueueNames } from '@nibleaf/bullmq';
import { ERASE_PROJECT_STORAGE_JOB_OPTIONS, eraseProjectStorageFinalPassJobId, type ReindexProjectJobData } from '@nibleaf/bullmq/jobs/search';
import { prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { DEFAULT_PRESIGN_EXPIRES_IN_SECONDS, deletePrefix } from '@nibleaf/storage';
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

const PROJECT_EXISTS_MESSAGE = 'Project still exists; storage erasure waits for relational deletion.';

/** The queue's failure log and stored reason keep this error's message. A storage
 * backend's own error may name an object, so only known key-free failures pass. */
const keyFreeFailure = (error: unknown): Error => {
  if (error instanceof Error && (error.name === 'StorageDeleteError' || error.message === PROJECT_EXISTS_MESSAGE)) return error;
  const name = error instanceof Error && /^\w{1,64}$/.test(error.name) ? error.name : 'UnknownError';
  return new Error(`Project storage erasure failed (${name}).`);
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
  if (project) throw new Error(PROJECT_EXISTS_MESSAGE);
  return deletePrefix(prefix);
};

/** Run one `erase-project-storage` pass. The first successful pass schedules the
 * final one; the final pass never schedules another. */
export const handleProjectStorageErasure = async (job: Job<ReindexProjectJobData>) => {
  const { projectId, finalPass = false } = job.data;
  try {
    const storageObjects = await eraseProjectStorage(projectId);
    if (!finalPass) {
      await createJob(
        QueueNames.SEARCH,
        { name: 'erase-project-storage', data: { projectId, finalPass: true } },
        { ...ERASE_PROJECT_STORAGE_JOB_OPTIONS, jobId: eraseProjectStorageFinalPassJobId(projectId), delay: FINAL_PASS_DELAY_MS },
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
