import { type MutationKey, useIsMutating } from '@tanstack/react-query';
import type { WorkspaceSettings } from '@/hooks/api';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { workspaceSettingsQueryOptions } from '@/hooks/api/query-options';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { type GitConnectionValues, gitConnectionPayload } from '../model/git-connection';

// A fixed key: a key built from the rendered site would be rewritten on a pending request by a later render.
// Each request's own variables say which site it is for.
const GIT_CONNECTION_KEY: MutationKey = ['site-git', 'connection'];

export type GitConnectionSave = { projectId: string; values: GitConnectionValues };

const isSaveFor = (variables: unknown, projectId: string) => (variables as GitConnectionSave | undefined)?.projectId === projectId;

/**
 * Saves a site's repository connection (the legacy import's Repository
 * settings). Class: form save, not optimistic. The PATCH replaces `git`
 * wholesale, so the request sends the whole object (`gitConnectionPayload`),
 * with `autoPublish` as the site's settings hold it when the request starts:
 * the cached settings, or a fresh read when a failed refetch left them
 * invalidated (a known-stale `autoPublish` is never sent back).
 *
 * Success and failure both read back the settings of the site the request was
 * for, whatever the page shows by then, and resolve or reject only after that
 * read. Resolves the settings the PATCH returned. No `meta.errorMessage`: the
 * caller owns the error. Not retried.
 *
 * `pending` and `isPending()` say whether a save for `projectId` is in flight,
 * from any instance: `pending` for rendering, `isPending()` for a press, which
 * reads the cache in the same tick, before any render.
 */
export function useSaveGitConnection(projectId: string) {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: GIT_CONNECTION_KEY,
    mutationFn: async ({ projectId, values }: GitConnectionSave) => {
      const settings = workspaceSettingsQueryOptions(projectId);
      const state = queryClient.getQueryState(settings.queryKey);
      const current = state?.data && !state.isInvalidated ? state.data : await queryClient.fetchQuery({ ...settings, staleTime: 0 });
      return mutateData<WorkspaceSettings>(
        await api.app.projects[':projectId'].settings.$patch({ param: { projectId }, json: { git: gitConnectionPayload(values, current.git) } }),
        'Could not update settings.',
      );
    },
    onSettled: (_settings, _error, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.workspace.projectSettings(projectId) }),
  });
  const filters = {
    mutationKey: GIT_CONNECTION_KEY,
    predicate: ({ state }: { state: { variables: unknown } }) => isSaveFor(state.variables, projectId),
  };
  const pending = useIsMutating(filters) > 0;
  return { save: mutateAsync, pending, isPending: () => queryClient.isMutating(filters) > 0 };
}
