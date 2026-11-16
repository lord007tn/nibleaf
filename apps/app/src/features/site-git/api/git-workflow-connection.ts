import { type MutationKey, useIsMutating } from '@tanstack/react-query';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { gitWorkflowQueryOptions } from '@/hooks/api/query-options';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { type GitWorkflowConnectionValues, gitWorkflowConnectionPayload, type StoredGitWorkflowConnection } from '../model/git-workflow-connection';

// A fixed key: a key built from the rendered site would be rewritten on a pending request by a later render.
// Each request's own variables say which site it is for.
const GIT_WORKFLOW_CONNECTION_KEY: MutationKey = ['site-git', 'workflow-connection'];

/** A connection save, as the mutation cache holds it: never the token. */
export type GitWorkflowConnectionSave = { projectId: string; values: GitWorkflowConnectionValues };

/** What `PUT /git/connection` answers: the stored connection (redacted) and a webhook secret only when it made one. */
export type GitWorkflowConnectionResult = { connection: StoredGitWorkflowConnection; webhookSecret: string | null };

// The token typed for a save, beside its variables rather than in them, so it never sits in the mutation cache.
const tokens = new WeakMap<GitWorkflowConnectionSave, string>();

const isSaveFor = (variables: unknown, projectId: string) => (variables as { projectId?: string } | undefined)?.projectId === projectId;

/**
 * Saves a connected site's GitHub connection settings (Connection
 * configuration). Class: form save, not optimistic. The PUT replaces the
 * connection, so the request sends the import branch and language as the
 * site's status holds them when it starts: the cached status, or a fresh
 * read when a failed refetch left it invalidated (a known-stale target is
 * never sent back).
 *
 * `save(request, token)`: the token goes only into the request body, and only
 * when one was typed. A success refreshes the status of the site the request
 * was for, whatever the page shows by then, and resolves after that read with
 * the PUT's answer. A failure refreshes nothing. No `meta.errorMessage`: the
 * caller owns the error. Not retried.
 *
 * `pending` and `isPending()` say whether a save for `projectId` is in flight
 * from any instance: `pending` for rendering, `isPending()` for a press, which
 * reads the cache in the same tick. A save started before leaving and coming
 * back to a site still counts.
 */
export function useSaveGitWorkflowConnection(projectId: string) {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: GIT_WORKFLOW_CONNECTION_KEY,
    mutationFn: async (variables: GitWorkflowConnectionSave) => {
      const token = tokens.get(variables);
      tokens.delete(variables);
      const status = gitWorkflowQueryOptions(variables.projectId);
      const state = queryClient.getQueryState(status.queryKey);
      const current = state?.data !== undefined && !state.isInvalidated ? state.data : await queryClient.fetchQuery({ ...status, staleTime: 0 });
      return mutateData<GitWorkflowConnectionResult>(
        await api.app.projects[':projectId'].git.connection.$put({
          param: { projectId: variables.projectId },
          json: gitWorkflowConnectionPayload(variables.values, current, token),
        }),
        'Could not connect the repository.',
      );
    },
    onSuccess: (_result, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(projectId) }),
  });
  const filters = {
    mutationKey: GIT_WORKFLOW_CONNECTION_KEY,
    predicate: ({ state }: { state: { variables: unknown } }) => isSaveFor(state.variables, projectId),
  };
  const pending = useIsMutating(filters) > 0;
  const save = (request: GitWorkflowConnectionSave, token?: string) => {
    const variables = { projectId: request.projectId, values: request.values };
    if (token) tokens.set(variables, token);
    return mutateAsync(variables);
  };
  return { save, pending, isPending: () => queryClient.isMutating(filters) > 0 };
}
