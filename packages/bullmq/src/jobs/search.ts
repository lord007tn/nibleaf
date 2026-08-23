export type SearchJobName = 'index-deployment' | 'reindex-project' | 'delete-deployment' | 'delete-project';

export interface ReindexProjectJobData {
  projectId: string;
  deploymentId?: string;
}
