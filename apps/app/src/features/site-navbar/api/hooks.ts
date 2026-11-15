import { useLanguages, useUpdateLanguage, useUpdateProjectConfig } from '@/hooks/api';
import {
  languageNavbarConfig,
  languageNavbarValues,
  type NavbarConfig,
  type NavbarValues,
  navbarValues,
  projectNavbarPatch,
  type StoredCta,
  storedCta,
} from '../model/navbar';

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

  /**
   * `stored` is the CTA texts the server holds, so a cleared one is sent as `''`.
   * Resolves the stored values and which CTA texts the server now holds.
   */
  const saveProject = async (values: NavbarValues, stored: StoredCta) => {
    const project = await updateProject.mutateAsync({ config: { navbar: projectNavbarPatch(values, stored) } });
    const navbar = project.config?.navbar;
    return { values: navbarValues(navbar), stored: storedCta(navbar) };
  };

  /** Sends the CTA label and lists only; `projectNavbar` fills the read-only global fields of the result. */
  const saveLanguage = async (languageId: string, values: NavbarValues, projectNavbar: NavbarConfig | null | undefined) => {
    const language = await updateLanguage.mutateAsync({ id: languageId, body: { config: languageNavbarConfig(values) } });
    return languageNavbarValues(language.config?.navbar, projectNavbar);
  };

  return { saveProject, saveLanguage };
}
