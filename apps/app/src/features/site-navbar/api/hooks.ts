import { useLanguages, useUpdateLanguage, useUpdateProjectConfig } from '@/hooks/api';
import { languageNavbarConfig, languageNavbarValues, type NavbarConfig, type NavbarValues, navbarValues, projectNavbarPatch } from '../model/navbar';

/** The site's languages: every non-default one is a navbar scope. */
export const useNavbarLanguages = (projectId: string) => useLanguages(projectId);

/**
 * Saves one navbar scope. Class: form save (operations/ui-overhaul.md §8.2),
 * not optimistic. The project save invalidates the project (detail and list),
 * a language save the language list; each resolves after that refetch
 * settles, whether or not the refetch succeeded.
 *
 * Each resolves what the server stored, read from the entity its own PATCH
 * returns, and rejects on failure so the form keeps its draft. Neither
 * mutation sets `meta.errorMessage`: the caller owns the error.
 */
export function useSaveNavbar(projectId: string) {
  const updateProject = useUpdateProjectConfig(projectId);
  const updateLanguage = useUpdateLanguage(projectId);

  /** Sends the fields the draft changed from `baseline`, the server's values when the save started. */
  const saveProject = async (values: NavbarValues, baseline: NavbarValues) => {
    const project = await updateProject.mutateAsync({ config: { navbar: projectNavbarPatch(values, baseline) } });
    return navbarValues(project.config?.navbar);
  };

  /** Sends the CTA label and lists only; `projectNavbar` fills the read-only global fields of the result. */
  const saveLanguage = async (languageId: string, values: NavbarValues, projectNavbar: NavbarConfig | null | undefined) => {
    const language = await updateLanguage.mutateAsync({ id: languageId, body: { config: languageNavbarConfig(values) } });
    return languageNavbarValues(language.config?.navbar, projectNavbar);
  };

  return { saveProject, saveLanguage };
}
