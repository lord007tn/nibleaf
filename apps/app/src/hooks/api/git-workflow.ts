import type { GitConflictResolutionBody, GitConnectionBody, GitOperationBody } from '@nibleaf/validators';
import { useQuery } from '@tanstack/react-query';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { mutateData } from './client-helpers';
import { queryKeys } from './query-keys';
import { gitWorkflowQueryOptions } from './query-options';

export interface GitConflict {
  id: string;
  path: string;
  status: string;
  baseContent: string | null;
  oursContent: string | null;
  theirsContent: string | null;
}

export interface GitOperation {
  id: string;
  kind: string;
  status: string;
  commitMessage: string | null;
  changedFiles: Array<{ path: string; status: string }> | null;
  pullRequestNo: number | null;
  pullRequestUrl: string | null;
  error: string | null;
  createdAt: string;
  conflicts: GitConflict[];
}

export interface GitWorkflowStatus {
  id: string;
  repository: string;
  baseBranch: string;
  headBranch: string;
  contentPath: string;
  credentialConfigured: boolean;
  webhookConfigured: boolean;
  lastSyncStatus: string;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  operations: GitOperation[];
  pullRequests: Array<{
    id: string;
    number: number;
    url: string;
    title: string;
    draft: boolean;
    state: string;
    previews: Array<{ id: string; status: string; url: string | null; error: string | null }>;
  }>;
  files: Array<{ path: string }>;
}

/** Repository connection and recent operations. Polls while an operation is queued or running. */
export const useGitWorkflow = (projectId: string) =>
  useQuery({
    ...gitWorkflowQueryOptions(projectId),
    refetchInterval: (query) =>
      query.state.data?.operations.some((operation) => operation.status === 'QUEUED' || operation.status === 'RUNNING') ? 2500 : false,
  });

const useGitWorkflowMutation = <TVariables, TResult>(projectId: string, mutationFn: (variables: TVariables) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(projectId) }),
  });
};

export const useResolveGitConflict = (projectId: string, conflictId: string) =>
  useGitWorkflowMutation(projectId, async (json: GitConflictResolutionBody) =>
    mutateData(
      await api.app.projects[':projectId'].git.conflicts[':conflictId'].resolve.$post({
        param: { projectId, conflictId },
        json,
      }),
      'Could not resolve the conflict.',
    ),
  );

// Authorizing stores the credential, which the status shows (`credentialConfigured`).
export const useAuthorizeGitWorkflow = (projectId: string) =>
  useGitWorkflowMutation(projectId, async (token: string) =>
    mutateData(
      await api.app.projects[':projectId'].git.authorize.$post({ param: { projectId }, json: { token } }),
      'Could not authorize the GitHub account.',
    ),
  );

export const useConnectGitWorkflow = (projectId: string) =>
  useGitWorkflowMutation(projectId, async (json: GitConnectionBody) =>
    mutateData(await api.app.projects[':projectId'].git.connection.$put({ param: { projectId }, json }), 'Could not connect the repository.'),
  );

export const useDisconnectGitWorkflow = (projectId: string) =>
  useGitWorkflowMutation(projectId, async (_: undefined) =>
    mutateData(await api.app.projects[':projectId'].git.connection.$delete({ param: { projectId } }), 'Could not disconnect the repository.'),
  );

export const useQueueGitOperation = (projectId: string) =>
  useGitWorkflowMutation(projectId, async (json: GitOperationBody) =>
    mutateData<GitOperation>(
      await api.app.projects[':projectId'].git.operations.$post({ param: { projectId }, json }),
      'Could not queue the Git operation.',
    ),
  );

export const useRotateGitWorkflowWebhookSecret = (projectId: string) =>
  useGitWorkflowMutation(projectId, async (_: undefined) =>
    mutateData(await api.app.projects[':projectId'].git['webhook-secret'].$post({ param: { projectId } }), 'Could not rotate the webhook secret.'),
  );
