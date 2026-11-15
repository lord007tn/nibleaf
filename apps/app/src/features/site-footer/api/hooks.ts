import { useLanguages, useUpdateLanguage, useUpdateProjectConfig } from '@/hooks/api';
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
 */
export function useSaveFooter(projectId: string) {
  const updateProject = useUpdateProjectConfig(projectId);
  const updateLanguage = useUpdateLanguage(projectId);

  /**
   * `stored` is the project's footer as the form knows it, so a blank text
   * clears what it holds. Resolves the stored values and the stored footer
   * itself, whose keys say which texts the server now holds.
   */
  const saveProject = async (values: FooterValues, stored: FooterConfig | null | undefined) => {
    const project = await updateProject.mutateAsync({ config: { footer: projectFooterPatch(values, stored) } });
    const footer = project.config?.footer;
    return { values: footerValues(footer), stored: footer };
  };

  /** Sends the copyright only; `projectFooter` fills the read-only global fields of the result. */
  const saveLanguage = async (languageId: string, values: FooterValues, projectFooter: FooterConfig | null | undefined) => {
    const language = await updateLanguage.mutateAsync({ id: languageId, body: { config: languageFooterConfig(values) } });
    return languageFooterValues(language.config?.footer, projectFooter);
  };

  return { saveProject, saveLanguage };
}
