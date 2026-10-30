export type SearchJobName = 'index-deployment' | 'reindex-project' | 'delete-deployment' | 'delete-project' | 'erase-project-storage';

export interface ReindexProjectJobData {
  projectId: string;
  deploymentId?: string;
  /** Durable run created by an authenticated manual request. Automatic publish
   * jobs omit it and the worker creates the run under the same tenant scope. */
  runId?: string;
  /** `erase-project-storage` only: the delayed last pass, which never schedules another. */
  finalPass?: boolean;
}

/** BullMQ's exponential backoff has no cap, so 15 retries wait 5 s × (2^15 − 1),
 * about 45.5 hours in total: storage erasure outlasts an outage of nearly two days. */
export const ERASE_PROJECT_STORAGE_JOB_OPTIONS = { attempts: 16, backoff: { type: 'exponential', delay: 5000 } } as const;

export const eraseProjectStorageJobId = (projectId: string): string => `search-storage-erase-${projectId}`;
export const eraseProjectStorageFinalPassJobId = (projectId: string): string => `search-storage-final-${projectId}`;
