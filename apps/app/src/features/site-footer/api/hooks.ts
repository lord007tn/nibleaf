import { useQueryClient } from '@tanstack/react-query';
import { useLanguages, useUpdateLanguage, useUpdateProjectConfig } from '@/hooks/api';
import { queryKeys } from '@/hooks/api/query-keys';
import { type FooterConfig, type FooterValues, footerValues, languageFooterConfig, languageFooterValues, projectFooterPatch } from '../model/footer';

/** The site's languages: every non-default one is a footer scope. */
export const useFooterLanguages = (projectId: string) => useLanguages(projectId);

/**
 * Saves one footer scope. Class: form save (operations/ui-overhaul.md §8.2),
 * not optimistic. The project save invalidates the project (detail and list),
 * a language save the language list; each resolves only after that refetch.
 * A refetch that fails leaves the project query invalidated (stale), so the
 * next mount or scope switch reads it again (`useRefreshStaleProject`).
 *
 * Each resolves the footer values the server stored, read from the entity it
 * returns, and rejects on failure so the form keeps its draft. Neither
 * mutation sets `meta.errorMessage`: the caller owns the error.
 */
export function useSaveFooter(projectId: string) {
  const updateProject = useUpdateProjectConfig(projectId);
  const updateLanguage = useUpdateLanguage(projectId);

  /** Sends only the keys changed from `baseline`, the draft's confirmed values (see `projectFooterPatch`). */
  const saveProject = async (values: FooterValues, baseline: FooterValues) => {
    const project = await updateProject.mutateAsync({ config: { footer: projectFooterPatch(values, baseline) } });
    return footerValues(project.config?.footer);
  };

  /** Sends the copyright only; `projectFooter` fills the read-only global fields of the result. */
  const saveLanguage = async (languageId: string, values: FooterValues, projectFooter: FooterConfig | null | undefined) => {
    const language = await updateLanguage.mutateAsync({ id: languageId, body: { config: languageFooterConfig(values) } });
    return languageFooterValues(language.config?.footer, projectFooter);
  };

  return { saveProject, saveLanguage };
}

/**
 * Reads the site's project again if TanStack Query holds it as stale (a
 * refetch after a save failed, so it is still invalidated); a fresh one is
 * left alone. The form calls it on a scope switch, which starts a draft from
 * the project query without remounting it.
 */
export function useRefreshStaleProject(projectId: string) {
  const queryClient = useQueryClient();
  return () => void queryClient.refetchQueries({ queryKey: queryKeys.projects.detail(projectId), type: 'active', stale: true });
}
