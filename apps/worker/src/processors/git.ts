import type { GitSyncJobData, GitSyncJobName } from '@nibleaf/bullmq/jobs/git';
import { createLogger } from '@nibleaf/logger';
import type { Job } from 'bullmq';
import { env } from '../env';

const log = createLogger({ processor: 'git' });

/** Execute Git work through the API process, where the envelope-encryption key
 * lives. Redis carries only the operation id and this internal call is protected
 * by a distinct shared worker secret. BullMQ retries make delivery at-least-once;
 * the durable operation makes execution idempotent. */
export async function handleGitJobs(job: Job<GitSyncJobData, unknown, GitSyncJobName>): Promise<void> {
  if (!env.GIT_WORKER_SECRET) {
    throw new Error('GIT_WORKER_SECRET is required to process Git jobs.');
  }
  const response = await fetch(`${env.API_URL.replace(/\/$/, '')}/api/public/git/jobs/${encodeURIComponent(job.data.operationId)}`, {
    method: 'POST',
    headers: { 'X-Nibleaf-Git-Worker': env.GIT_WORKER_SECRET },
    signal: AbortSignal.timeout(9 * 60_000),
  });
  if (!response.ok) {
    throw new Error(`Git operation endpoint returned ${response.status}.`);
  }
  log.info({ operationId: job.data.operationId }, 'git operation processed');
}
