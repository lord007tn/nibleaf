import { useLanguages, useUpdateLanguage, useUpdateProjectConfig } from '@/hooks/api';
import {
  type BannerConfig,
  type BannerValues,
  languageBannerOverride,
  languageBannerValues,
  projectBannerPatch,
  projectBannerValues,
} from '../model/banner';

/** The site's languages: every non-default one is a banner scope. */
export const useBannerLanguages = (projectId: string) => useLanguages(projectId);

/**
 * Saves one banner scope. Class: form save (operations/ui-overhaul.md §8.2),
 * not optimistic. The project save invalidates the project (detail and list),
 * a language save the language list; each resolves only after that refetch.
 *
 * Both reject on failure, so the form keeps its draft. Neither mutation sets
 * `meta.errorMessage`, so the caller owns the error and the global cache
 * stays quiet. Each resolves the values the server stored, read back from its
 * response.
 */
export function useSaveBanner(projectId: string) {
  const updateProject = useUpdateProjectConfig(projectId);
  const updateLanguage = useUpdateLanguage(projectId);

  const saveProject = async (values: BannerValues) => {
    const project = await updateProject.mutateAsync({ config: { banner: projectBannerPatch(values) } });
    return projectBannerValues(project.config?.banner);
  };

  const saveLanguage = async (languageId: string, values: BannerValues, projectBanner: BannerConfig | undefined) => {
    const language = await updateLanguage.mutateAsync({
      id: languageId,
      body: { config: { banner: languageBannerOverride(values, projectBanner) } },
    });
    return languageBannerValues(language.config?.banner, projectBanner);
  };

  return { saveProject, saveLanguage };
}
