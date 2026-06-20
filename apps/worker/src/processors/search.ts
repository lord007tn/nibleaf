import type { ReindexProjectJobData } from '@plume/bullmq/jobs/search';
import { createLogger } from '@plume/logger';
import type { Job } from 'bullmq';

const log = createLogger({ processor: 'search' });

/**
 * The API rebuilds its in-memory Orama index lazily, keyed by the published
 * deployment id, so an explicit reindex is a hook for future external indexes
 * (e.g. persisting a serialized index to object storage). For now it records
 * the request so reindexing is observable in the job board.
 */
export async function handleSearchJobs(job: Job<ReindexProjectJobData>): Promise<{ reindexed: boolean }> {
  log.info({ projectId: job.data.projectId, deploymentId: job.data.deploymentId }, 'reindex requested');
  return { reindexed: true };
}
