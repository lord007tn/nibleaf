export type ErasureJobName = 'erase-project-storage';

export interface EraseProjectStorageJobData {
  projectId: string;
  /** The delayed last pass, which never schedules another. */
  finalPass?: boolean;
}

/** BullMQ's exponential backoff has no cap, so 15 retries wait 5 s × (2^15 − 1),
 * about 45.5 hours in total: storage erasure outlasts an outage of nearly two days.
 * A failed job is kept until an operator acts on it: the project row is already
 * gone, so nothing else can queue this erasure again. */
export const ERASURE_JOB_OPTIONS = { attempts: 16, backoff: { type: 'exponential', delay: 5000 }, removeOnFail: false } as const;

/** Gives the relational delete time to commit, so a normal deletion logs no failed attempt. */
export const ERASE_PROJECT_STORAGE_START_DELAY_MS = 60 * 1000;

export const eraseProjectStorageJobId = (projectId: string): string => `erase-storage-${projectId}`;
export const eraseProjectStorageFinalPassJobId = (projectId: string): string => `erase-storage-final-${projectId}`;
