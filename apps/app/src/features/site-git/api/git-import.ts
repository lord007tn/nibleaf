import { type MutationKey, useIsMutating } from '@tanstack/react-query';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';

// A fixed key: a key built from the rendered site would be rewritten on a pending request by a later render.
// Each request's own variables say which site it is for.
const GIT_IMPORT_KEY: MutationKey = ['site-git', 'import'];

/** One manual import of the legacy Git connection: the site it pulls into. */
export type GitImportRequest = { projectId: string };

const isGitImportFor = (variables: unknown, projectId: string) => (variables as Partial<GitImportRequest> | undefined)?.projectId === projectId;

const sendGitImport = async ({ projectId }: GitImportRequest) =>
  mutateData(await api.app.projects[':projectId'].settings.git.import.$post({ param: { projectId } }), 'Could not import from Git.');

/** What a finished import reports: how many pages it created and updated. */
export type GitImportSummary = Awaited<ReturnType<typeof sendGitImport>>;

/**
 * Pulls Markdown pages from the site's legacy Git connection (one-way import):
 * an empty POST for the request's site. A success refreshes that site's
 * settings and pages, whatever site the page shows by then; a failure
 * refreshes nothing. Not retried.
 *
 * `pending` and `isPending()` say whether an import for `projectId` is in
 * flight, from any instance: `pending` for rendering, `isPending()` for a
 * press, which reads the cache in the same tick, before any render.
 */
export function useGitImport(projectId: string) {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: GIT_IMPORT_KEY,
    mutationFn: sendGitImport,
    onSuccess: (_summary, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace.projectSettings(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    },
  });
  const filters = {
    mutationKey: GIT_IMPORT_KEY,
    predicate: ({ state }: { state: { variables: unknown } }) => isGitImportFor(state.variables, projectId),
  };
  const pending = useIsMutating(filters) > 0;
  return { pending, isPending: () => queryClient.isMutating(filters) > 0, send: mutateAsync };
}
