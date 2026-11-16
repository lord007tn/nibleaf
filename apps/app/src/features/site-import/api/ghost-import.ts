import { type MutationKey, useIsMutating } from '@tanstack/react-query';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { type GhostImportRequest, isGhostImportFor } from '../model/ghost-import';

// A fixed key: a key built from the rendered site would be rewritten on a pending request by a later render.
// Each request's own variables say which site it is for.
const GHOST_IMPORT_KEY: MutationKey = ['site-import', 'ghost'];

/**
 * One-way import of a Ghost JSON export into the request's site (published
 * posts and pages become Markdown pages). A success refreshes that site's
 * pages, whatever site the page shows by then. Not retried.
 *
 * `pending` and `isPending()` say whether an import for `projectId` is in
 * flight, from any instance: `pending` for rendering, `isPending()` for a
 * press, which reads the cache in the same tick, before any render.
 */
export function useGhostImport(projectId: string) {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: GHOST_IMPORT_KEY,
    mutationFn: async ({ projectId, body }: GhostImportRequest) =>
      mutateData(
        await api.app.projects[':projectId'].settings.import.ghost.$post({ param: { projectId }, json: body }),
        'Could not import from Ghost.',
      ),
    onSuccess: (_summary, { projectId }) => queryClient.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) }),
  });
  const filters = {
    mutationKey: GHOST_IMPORT_KEY,
    predicate: ({ state }: { state: { variables: unknown } }) => isGhostImportFor(state.variables, projectId),
  };
  const pending = useIsMutating(filters) > 0;
  return { pending, isPending: () => queryClient.isMutating(filters) > 0, send: mutateAsync };
}
