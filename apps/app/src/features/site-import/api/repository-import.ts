import { type MutationKey, useIsMutating } from '@tanstack/react-query';
import type { ContentImportSummary } from '@/hooks/api';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { isRepositoryImportFor, type RepositoryImportRequest } from '../model/repository-import';

// A fixed key: a key built from the rendered site would be rewritten on a pending request by a later render.
// Each request's own variables say which site and provider it is for.
const REPOSITORY_IMPORT_KEY: MutationKey = ['site-import', 'repository'];

const sendRepositoryImport = async (request: RepositoryImportRequest): Promise<ContentImportSummary> => {
  const param = { projectId: request.projectId };
  if (request.provider === 'mintlify') {
    return mutateData(
      await api.app.projects[':projectId'].settings.import.mintlify.$post({ param, json: request.body }),
      'Could not import from Mintlify.',
    );
  }
  return mutateData(
    await api.app.projects[':projectId'].settings.import.gitbook.$post({ param, json: request.body }),
    'Could not import from GitBook.',
  );
};

/**
 * One-way import of a public Mintlify or GitBook Git Sync repository into the
 * request's site. A success refreshes that site's pages and its project (the
 * importers may fill empty config keys, or write GitBook redirects), and the
 * projects list, whatever site the page shows by then. Not retried.
 *
 * `pending` and `isPending()` say whether a repository import for `projectId`
 * is in flight, from any instance: `pending` for rendering, `isPending()` for
 * a press, which reads the cache in the same tick, before any render.
 */
export function useRepositoryImport(projectId: string) {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: REPOSITORY_IMPORT_KEY,
    mutationFn: sendRepositoryImport,
    onSuccess: (_summary, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      // Global on purpose, as before: the list of every site shows this one too.
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
    },
  });
  const filters = {
    mutationKey: REPOSITORY_IMPORT_KEY,
    predicate: ({ state }: { state: { variables: unknown } }) => isRepositoryImportFor(state.variables, projectId),
  };
  const pending = useIsMutating(filters) > 0;
  return { pending, isPending: () => queryClient.isMutating(filters) > 0, send: mutateAsync };
}
