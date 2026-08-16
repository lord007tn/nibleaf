import { QueueNames } from '@nibleaf/bullmq';
import type { ProcessorRegistry } from '@nibleaf/bullmq/workers';
import { handleAnalyticsJobs } from './processors/analytics';
import { handleEmailJobs } from './processors/email';
import { handleExportJobs } from './processors/export';
import { handleGitJobs } from './processors/git';
import { handlePublishJobs } from './processors/publish';
import { handleSearchJobs } from './processors/search';

export const processors: ProcessorRegistry = {
  [QueueNames.PUBLISH]: handlePublishJobs,
  [QueueNames.SEARCH]: handleSearchJobs,
  [QueueNames.EMAIL]: handleEmailJobs,
  [QueueNames.ANALYTICS]: handleAnalyticsJobs,
  [QueueNames.EXPORT]: handleExportJobs,
  [QueueNames.GIT]: handleGitJobs,
};
