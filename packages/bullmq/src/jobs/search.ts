export type SearchJobName = 'reindex-project';

export interface ReindexProjectJobData {
  projectId: string;
  deploymentId?: string;
}
