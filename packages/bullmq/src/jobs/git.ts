export type GitSyncJobName = 'process-git-operation';

/** The worker intentionally carries only an opaque operation id. Credentials,
 * repository names, commit messages, and webhook bodies never enter Redis. */
export interface GitSyncJobData {
  operationId: string;
}
