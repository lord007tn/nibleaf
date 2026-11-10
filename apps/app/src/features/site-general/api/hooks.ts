import { useLanguages, useUpdateLanguage, useUpdateProject } from '@/hooks/api';
import { type GeneralValues, generalSaveRequests } from '../model/general';

/** The languages the General form edits translations for (shared with the site's language list). */
export const useGeneralLanguages = (projectId: string) => useLanguages(projectId);

/**
 * Saves the General form: the site fields in one request, then each changed
 * translation. Class: form save (operations/ui-overhaul.md §8.2). It is not
 * optimistic; the underlying mutations invalidate the project (detail and
 * list) and the language list.
 *
 * `save` rejects on the first failure so the form stays dirty. The caller owns
 * the error: it maps a taken address to the field and words everything else
 * with `friendlyErrorMessage`. These mutations set no `meta.errorMessage`, so
 * the global cache stays quiet.
 */
export function useSaveGeneral(projectId: string) {
  const updateProject = useUpdateProject(projectId);
  const updateLanguage = useUpdateLanguage(projectId);
  const save = async (baseline: GeneralValues, submitted: GeneralValues) => {
    const { project, translations } = generalSaveRequests(baseline, submitted);
    if (project) await updateProject.mutateAsync(project);
    for (const { id, translation } of translations) {
      await updateLanguage.mutateAsync({ id, body: { translation } });
    }
  };
  return { save, isPending: updateProject.isPending || updateLanguage.isPending };
}
