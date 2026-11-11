import {
  useCreateProjectSearchReindex,
  useLanguages,
  useProjectSearchConfiguration,
  useProjectSearchIndexDiagnostics,
  useUpdateLanguage,
  useUpdateProjectSearchConfiguration,
} from '@/hooks/api';
import { useWorkspaceAi } from '@/hooks/api/workspace-ai';
import { type SearchValues, searchSaveRequests } from '../model/search';

/** The site's resolved search configuration and the server's allowed ranges. */
export const useSearchConfiguration = (projectId: string) => useProjectSearchConfiguration(projectId);

/** The languages whose placeholders the form edits (shared with the site's language list). */
export const useSearchLanguages = (projectId: string) => useLanguages(projectId);

/** The site's Smart AI settings: whether grounded answers can be served (see `groundedAnswersState`). */
export const useSearchAi = (projectId: string) => useWorkspaceAi(projectId);

/** The index's health, counts and a page of samples; polls while a run is going. */
export const useSearchIndexDiagnostics = (projectId: string, cursor?: string) => useProjectSearchIndexDiagnostics(projectId, cursor);

/**
 * Queues a reindex. Class: server-confirmed (operations/ui-overhaul.md §8.2):
 * the server decides whether a run can start. Its failure is toasted by the
 * shared mutation (`meta.errorMessage`), worded for "nothing published" and
 * "already running".
 */
export const useReindexSearch = (projectId: string) => useCreateProjectSearchReindex(projectId);

/** A failure the shared mutation has already told the person about (its `meta.errorMessage`). */
class ReportedError extends Error {
  constructor(readonly original: unknown) {
    super('Already reported');
  }
}

/** Whether a failed save was already toasted, so the form must not toast it again. */
export const wasReported = (error: unknown) => error instanceof ReportedError;

/**
 * Saves the Search form: the changed configuration fields in one request,
 * then each changed language placeholder. Class: form save (§8.2). It is not
 * optimistic; the configuration mutation writes its result to the cache and
 * invalidates the project and the published reader's shell and search; the
 * language mutation invalidates the language list.
 *
 * `save` rejects on the first failure so the form stays dirty. The
 * configuration mutation toasts its own failure, so that rejection is marked
 * `wasReported`; a language failure is the caller's to word.
 */
export function useSaveSearch(projectId: string) {
  const updateConfiguration = useUpdateProjectSearchConfiguration(projectId);
  const updateLanguage = useUpdateLanguage(projectId);
  const save = async (baseline: SearchValues, submitted: SearchValues) => {
    const { configuration, languages } = searchSaveRequests(baseline, submitted);
    if (configuration) {
      try {
        await updateConfiguration.mutateAsync(configuration);
      } catch (error) {
        throw new ReportedError(error);
      }
    }
    for (const { id, placeholder } of languages) {
      await updateLanguage.mutateAsync({ id, body: { config: { search: placeholder ? { placeholder } : null } } });
    }
  };
  return { save, isPending: updateConfiguration.isPending || updateLanguage.isPending };
}
