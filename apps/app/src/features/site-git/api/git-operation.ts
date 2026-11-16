import { type MutationKey, useIsMutating } from '@tanstack/react-query';
import type { GitOperation } from '@/hooks/api';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { type GitOperationRequest, isGitOperationFor } from '../model/git-operation';

// A fixed key: a key built from the rendered site would be rewritten on a pending request by a later render.
// Each request's own variables say which site it is for.
const GIT_OPERATION_KEY: MutationKey = ['site-git', 'operation'];

/**
 * Queues a Sync (PULL) or Update PR (PUSH) operation for the request's site. A
 * success refreshes that site's Git workflow status, whatever site the page
 * shows by then, and settles only after that read. Not retried.
 *
 * `pending` and `isPending()` say whether an operation request for `projectId`
 * is in flight, from any instance: `pending` for rendering, `isPending()` for a
 * press, which reads the cache in the same tick, before any render. The
 * operation the server then runs (QUEUED, RUNNING) is not part of it.
 */
export function useGitOperation(projectId: string) {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: GIT_OPERATION_KEY,
    mutationFn: async ({ projectId, body }: GitOperationRequest) =>
      mutateData<GitOperation>(
        await api.app.projects[':projectId'].git.operations.$post({ param: { projectId }, json: body }),
        'Could not queue the Git operation.',
      ),
    onSuccess: (_operation, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(projectId) }),
  });
  const filters = {
    mutationKey: GIT_OPERATION_KEY,
    predicate: ({ state }: { state: { variables: unknown } }) => isGitOperationFor(state.variables, projectId),
  };
  const pending = useIsMutating(filters) > 0;
  return { pending, isPending: () => queryClient.isMutating(filters) > 0, send: mutateAsync };
}
