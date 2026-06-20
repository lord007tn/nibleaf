import type { Job, JobsOptions } from 'bullmq';
import type { QueueNames } from './constants';
import type { AnalyticsJobName, RollupAnalyticsJobData } from './jobs/analytics';
import type { EmailJobName, SendEmailJobData } from './jobs/email';
import type { PublishDeploymentJobData, PublishJobName } from './jobs/publish';
import type { ReindexProjectJobData, SearchJobName } from './jobs/search';

/**
 * Maps each queue to the literal job name it accepts and the shape of its data.
 * This is what gives `createJob` / processors their end-to-end type safety.
 */
export interface QueueJobMap {
  [QueueNames.PUBLISH]: { name: PublishJobName; data: PublishDeploymentJobData };
  [QueueNames.SEARCH]: { name: SearchJobName; data: ReindexProjectJobData };
  [QueueNames.EMAIL]: { name: EmailJobName; data: SendEmailJobData };
  [QueueNames.ANALYTICS]: { name: AnalyticsJobName; data: RollupAnalyticsJobData };
}

export type CreateJobOptions = JobsOptions;

/** Registry of processors keyed by queue name. Only registered queues get a worker. */
export type ProcessorRegistry = Partial<{
  [Q in QueueNames]: (job: Job<QueueJobMap[Q]['data'], unknown, QueueJobMap[Q]['name']>) => Promise<unknown>;
}>;
