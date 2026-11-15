import { useQueryClient } from '@tanstack/react-query';
import { type Project, useLanguages, useUpdateLanguage, useUpdateProjectConfig } from '@/hooks/api';
import { queryKeys } from '@/hooks/api/query-keys';
import { type FooterConfig, type FooterValues, footerValues, languageFooterConfig, languageFooterValues, projectFooterPatch } from '../model/footer';

/** The site's languages: every non-default one is a footer scope. */
export const useFooterLanguages = (projectId: string) => useLanguages(projectId);

/**
 * Saves one footer scope. Class: form save (operations/ui-overhaul.md §8.2),
 * not optimistic. The project save invalidates the project (detail and list),
 * a language save the language list; each resolves only after that refetch.
 *
 * Each resolves the footer values the server stored, read from the entity it
 * returns, and rejects on failure so the form keeps its draft. Neither
 * mutation sets `meta.errorMessage`: the caller owns the error.
 *
 * The project query is the form's only source for which texts the server
 * stores (a blank stored text is cleared with `''`, a never-stored one left
 * out). When the refetch after a project save fails, that read predates the
 * save, so the save puts the footer it stored into its own site's cached
 * project. Only when no read has landed since the save began (the query's
 * `dataUpdateCount` is unchanged): a read that landed meanwhile is at least as
 * new and stays.
 */
export function useSaveFooter(projectId: string) {
  const queryClient = useQueryClient();
  const updateProject = useUpdateProjectConfig(projectId);
  const updateLanguage = useUpdateLanguage(projectId);

  /** `stored` is the project's footer as the project query last read it. */
  const saveProject = async (values: FooterValues, stored: FooterConfig | null | undefined) => {
    const key = queryKeys.projects.detail(projectId);
    const readsBefore = queryClient.getQueryState(key)?.dataUpdateCount;
    const project = await updateProject.mutateAsync({ config: { footer: projectFooterPatch(values, stored) } });
    const footer = project.config?.footer;
    if (readsBefore !== undefined && queryClient.getQueryState(key)?.dataUpdateCount === readsBefore) {
      queryClient.setQueryData<Project>(key, (cached) => cached && { ...cached, config: { ...cached.config, footer } });
    }
    return footerValues(footer);
  };

  /** Sends the copyright only; `projectFooter` fills the read-only global fields of the result. */
  const saveLanguage = async (languageId: string, values: FooterValues, projectFooter: FooterConfig | null | undefined) => {
    const language = await updateLanguage.mutateAsync({ id: languageId, body: { config: languageFooterConfig(values) } });
    return languageFooterValues(language.config?.footer, projectFooter);
  };

  return { saveProject, saveLanguage };
}
