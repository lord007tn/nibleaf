import { ERASURE_JOB_OPTIONS, type EraseProjectStorageJobData } from '@nibleaf/bullmq/jobs/erasure';
import { StorageDeleteError } from '@nibleaf/storage';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createJob: vi.fn(), deletePrefix: vi.fn(), logError: vi.fn(), projectFindUnique: vi.fn() }));

vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { ERASURE: 'erasure' } }));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => ({ error: mocks.logError }) }));
vi.mock('@nibleaf/storage', () => ({
  DEFAULT_PRESIGN_EXPIRES_IN_SECONDS: 3600,
  deletePrefix: mocks.deletePrefix,
  StorageDeleteError: class StorageDeleteError extends Error {},
}));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: mocks.projectFindUnique } } }));

import { eraseProjectStorage, FINAL_PASS_DELAY_MS, handleProjectStorageErasure } from './project-storage-erasure';

const erasureJob = (data: EraseProjectStorageJobData, attemptsMade = 0) =>
  ({ data, attemptsMade, opts: { attempts: ERASURE_JOB_OPTIONS.attempts } }) as unknown as Job<EraseProjectStorageJobData>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectFindUnique.mockResolvedValue(null);
  mocks.deletePrefix.mockResolvedValue(3);
  mocks.createJob.mockResolvedValue(undefined);
});

describe('project storage erasure', () => {
  it('deletes only the deleted project prefix', async () => {
    await expect(eraseProjectStorage('project-a')).resolves.toBe(3);
    expect(mocks.projectFindUnique).toHaveBeenCalledWith({ where: { id: 'project-a' }, select: { id: true } });
    expect(mocks.deletePrefix).toHaveBeenCalledExactlyOnceWith('projects/project-a/');
  });

  it('succeeds as a no-op when objects are already gone', async () => {
    mocks.deletePrefix.mockResolvedValue(0);
    await expect(eraseProjectStorage('project-a')).resolves.toBe(0);
  });

  it('retries while the project row still exists', async () => {
    mocks.projectFindUnique.mockResolvedValue({ id: 'project-a' });
    await expect(eraseProjectStorage('project-a')).rejects.toThrow('waits for relational deletion');
    expect(mocks.deletePrefix).not.toHaveBeenCalled();
  });

  it.each(['', 'a/b', '/', 'a/'])('rejects an id that would widen the prefix (%j)', async (projectId) => {
    await expect(eraseProjectStorage(projectId)).rejects.toBeInstanceOf(TypeError);
    expect(mocks.projectFindUnique).not.toHaveBeenCalled();
    expect(mocks.deletePrefix).not.toHaveBeenCalled();
  });

  it('propagates storage failures so the job retries', async () => {
    mocks.deletePrefix.mockRejectedValue(new Error('storage unavailable'));
    await expect(eraseProjectStorage('project-a')).rejects.toThrow('storage unavailable');
  });
});

describe('erase-project-storage job', () => {
  it('schedules one delayed final pass after a successful first pass', async () => {
    await expect(handleProjectStorageErasure(erasureJob({ projectId: 'project-a' }))).resolves.toEqual({ storageObjects: 3, finalPass: false });
    expect(mocks.createJob).toHaveBeenCalledExactlyOnceWith(
      'erasure',
      { name: 'erase-project-storage', data: { projectId: 'project-a', finalPass: true } },
      { jobId: 'erase-storage-final-project-a', delay: FINAL_PASS_DELAY_MS },
    );
  });

  it('waits a day before the final pass', () => {
    expect(FINAL_PASS_DELAY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('does not schedule another pass from the final pass', async () => {
    await expect(handleProjectStorageErasure(erasureJob({ projectId: 'project-a', finalPass: true }))).resolves.toEqual({
      storageObjects: 3,
      finalPass: true,
    });
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('does not schedule the final pass after a failed first pass', async () => {
    mocks.deletePrefix.mockRejectedValue(new Error('storage unavailable'));
    await expect(handleProjectStorageErasure(erasureJob({ projectId: 'project-a' }))).rejects.toThrow('Project storage erasure failed.');
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it.each([
    ['an HTTP failure', { $metadata: { httpStatusCode: 403 } }, 'Project storage erasure failed (HTTP 403).'],
    ['a backend name that imitates a safe error', { name: 'StorageDeleteError' }, 'Project storage erasure failed.'],
    ['a network failure', {}, 'Project storage erasure failed.'],
  ])('gives the queue a key-free error for %s', async (_case, details, message) => {
    const backendError = Object.assign(new Error('Could not read projects/project-a/assets/passport-scan.png'), details);
    mocks.deletePrefix.mockRejectedValue(backendError);
    const failure = await handleProjectStorageErasure(erasureJob({ projectId: 'project-a' })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(message);
    expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain('passport-scan');
  });

  it('keeps the counts and code of a partial delete failure', async () => {
    const partial = new StorageDeleteError(2, 3, 'AccessDenied');
    mocks.deletePrefix.mockRejectedValue(partial);
    await expect(handleProjectStorageErasure(erasureJob({ projectId: 'project-a' }))).rejects.toBe(partial);
  });

  it('logs one key-free error on the last attempt and still fails the job', async () => {
    mocks.deletePrefix.mockRejectedValue(new Error('projects/project-a/assets/passport-scan.png'));
    const job = erasureJob({ projectId: 'project-a' }, ERASURE_JOB_OPTIONS.attempts - 1);
    await expect(handleProjectStorageErasure(job)).rejects.toThrow();
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith({ projectId: 'project-a', finalPass: false }, expect.any(String));
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain('passport-scan');
  });

  it('never erases while the project row exists, even on the last attempt', async () => {
    mocks.projectFindUnique.mockResolvedValue({ id: 'project-a' });
    const job = erasureJob({ projectId: 'project-a' }, ERASURE_JOB_OPTIONS.attempts - 1);
    await expect(handleProjectStorageErasure(job)).rejects.toThrow('waits for relational deletion');
    expect(mocks.deletePrefix).not.toHaveBeenCalled();
  });

  it('keeps retrying for about 45.5 hours', () => {
    const { attempts, backoff } = ERASURE_JOB_OPTIONS;
    const totalSeconds = (backoff.delay * (2 ** (attempts - 1) - 1)) / 1000;
    expect(totalSeconds).toBe(163_835);
  });
});
