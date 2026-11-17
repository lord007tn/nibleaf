import type { UpdateWorkspaceSettingsBody } from '@nibleaf/validators';
import { type MutationKey, useIsMutating } from '@tanstack/react-query';
import type { WorkspaceSettings } from '@/hooks/api';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { workspaceSettingsQueryOptions } from '@/hooks/api/query-options';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { type GitConnectionValues, gitConnectionPayload } from '../model/git-connection';

// Every write to a site's `git` settings, under one fixed key: a key built from the rendered site would be
// rewritten on a pending request by a later render. Each request's own variables say which site it is for.
const GIT_SETTINGS_KEY: MutationKey = ['site-git', 'settings'];

type GitSettingsGit = NonNullable<UpdateWorkspaceSettingsBody['git']>;
export type GitConnectionSave = { projectId: string; values: GitConnectionValues };
/** An instant write: the whole `git` object, already built by the caller. */
export type GitSettingsWrite = { projectId: string; git: GitSettingsGit };

const isWriteFor = (variables: unknown, projectId: string) => (variables as { projectId?: string } | undefined)?.projectId === projectId;

/**
 * Whether a write to `projectId`'s `git` settings is in flight, from any
 * instance and of either kind (a repository save or an instant write): the
 * PATCH replaces `git` whole, so one must wait for the other. `pending` for
 * rendering, `isPending()` for a press, which reads the cache in the same
 * tick, before any render. It survives a remount: a write started before
 * leaving and coming back to a site still counts.
 */
function useGitSettingsPending(projectId: string) {
  const queryClient = useQueryClient();
  const filters = {
    mutationKey: GIT_SETTINGS_KEY,
    predicate: ({ state }: { state: { variables: unknown } }) => isWriteFor(state.variables, projectId),
  };
  const pending = useIsMutating(filters) > 0;
  return { pending, isPending: () => queryClient.isMutating(filters) > 0 };
}

const patchGit = async (projectId: string, git: GitSettingsGit) =>
  mutateData<WorkspaceSettings>(
    await api.app.projects[':projectId'].settings.$patch({ param: { projectId }, json: { git } }),
    'Could not update settings.',
  );

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
 * caller owns the error. Not retried. See `useGitSettingsPending` for
 * `pending` and `isPending()`.
 */
export function useSaveGitConnection(projectId: string) {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: GIT_SETTINGS_KEY,
    mutationFn: async ({ projectId, values }: GitConnectionSave) => {
      const settings = workspaceSettingsQueryOptions(projectId);
      const state = queryClient.getQueryState(settings.queryKey);
      const current = state?.data && !state.isInvalidated ? state.data : await queryClient.fetchQuery({ ...settings, staleTime: 0 });
      return patchGit(projectId, gitConnectionPayload(values, current.git));
    },
    onSettled: (_settings, _error, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.workspace.projectSettings(projectId) }),
  });
  return { save: mutateAsync, ...useGitSettingsPending(projectId) };
}

/**
 * The Git tab's instant writes (auto publish, disconnect, switching the legacy
 * import off): the `git` object the caller built, sent as is, as main's
 * settings mutation did. A success refreshes the settings of the site the
 * request was for and settles only after that read; a failure refreshes
 * nothing. No `meta.errorMessage`: the caller owns the error. Not retried. See
 * `useGitSettingsPending` for `pending` and `isPending()`.
 */
export function useWriteGitSettings(projectId: string) {
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    mutationKey: GIT_SETTINGS_KEY,
    mutationFn: ({ projectId, git }: GitSettingsWrite) => patchGit(projectId, git),
    onSuccess: (_settings, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.workspace.projectSettings(projectId) }),
  });
  return { write: mutate, ...useGitSettingsPending(projectId) };
}
