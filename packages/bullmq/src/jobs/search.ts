export type SearchJobName = 'index-deployment' | 'reindex-project' | 'delete-deployment' | 'delete-project';

export interface ReindexProjectJobData {
  projectId: string;
  deploymentId?: string;
  /** Durable run created by an authenticated manual request. Automatic publish
   * jobs omit it and the worker creates the run under the same tenant scope. */
  runId?: string;
}
