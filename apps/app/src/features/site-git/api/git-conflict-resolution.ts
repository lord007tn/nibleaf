import { type MutationKey, useIsMutating } from '@tanstack/react-query';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { type GitConflictResolutionRequest, isGitConflictResolutionFor } from '../model/git-conflict-resolution';

// A fixed key: a key built from the rendered site or conflict would be rewritten on a pending request by a later
// render. Each request's own variables say which site and conflict it is for.
const GIT_CONFLICT_RESOLUTION_KEY: MutationKey = ['site-git', 'conflict-resolution'];

const sendResolution = async ({ projectId, conflictId, body }: GitConflictResolutionRequest) =>
  mutateData(
    await api.app.projects[':projectId'].git.conflicts[':conflictId'].resolve.$post({ param: { projectId, conflictId }, json: body }),
    'Could not resolve the conflict.',
  );

/**
 * Resolves one conflict of a site's two-way sync: the request's body, for the
 * request's site and conflict. A success refreshes that site's Git workflow
 * status, whatever the page shows by then, and settles only after that read
 * (the resolved conflict leaves the list then). A failure refreshes nothing.
 * Not retried.
 *
 * `pending` and `isPending()` say whether a resolution of this site's conflict
 * is in flight, from any instance: `pending` for rendering, `isPending()` for a
 * press, which reads the cache in the same tick, before any render.
 */
export function useGitConflictResolution(projectId: string, conflictId: string) {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: GIT_CONFLICT_RESOLUTION_KEY,
    mutationFn: sendResolution,
    onSuccess: (_conflict, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(projectId) }),
  });
  const filters = {
    mutationKey: GIT_CONFLICT_RESOLUTION_KEY,
    predicate: ({ state }: { state: { variables: unknown } }) => isGitConflictResolutionFor(state.variables, projectId, conflictId),
  };
  const pending = useIsMutating(filters) > 0;
  return { pending, isPending: () => queryClient.isMutating(filters) > 0, send: mutateAsync };
}
