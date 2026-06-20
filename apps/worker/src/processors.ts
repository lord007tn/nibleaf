import { QueueNames } from '@plume/bullmq';
import type { ProcessorRegistry } from '@plume/bullmq/workers';
import { handleAnalyticsJobs } from './processors/analytics';
import { handleEmailJobs } from './processors/email';
import { handlePublishJobs } from './processors/publish';
import { handleSearchJobs } from './processors/search';

export const processors: ProcessorRegistry = {
  [QueueNames.PUBLISH]: handlePublishJobs,
  [QueueNames.SEARCH]: handleSearchJobs,
  [QueueNames.EMAIL]: handleEmailJobs,
  [QueueNames.ANALYTICS]: handleAnalyticsJobs,
};
