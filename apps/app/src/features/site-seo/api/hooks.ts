import { useLanguages, useUpdateLanguage, useUpdateProjectConfig, useUploadAsset } from '@/hooks/api';
import { languageSeoConfig, projectSeoPatch, type SeoValues, seoValues } from '../model/seo';

/** The site's languages: every non-default one is an SEO scope. */
export const useSeoLanguages = (projectId: string) => useLanguages(projectId);

/**
 * Saves one SEO scope. Class: form save (operations/ui-overhaul.md §8.2), not
 * optimistic. The project save invalidates the project (detail and list), a
 * language save the language list; each resolves only after that refetch.
 *
 * Each resolves the SEO values the server stored, read from the entity it
 * returns, and rejects on failure so the form keeps its draft. Neither
 * mutation sets `meta.errorMessage`: the caller owns the error.
 */
export function useSaveSeo(projectId: string) {
  const updateProject = useUpdateProjectConfig(projectId);
  const updateLanguage = useUpdateLanguage(projectId);

  const saveProject = async (values: SeoValues) => {
    const project = await updateProject.mutateAsync({ config: { seo: projectSeoPatch(values) } });
    return seoValues(project.config?.seo);
  };

  const saveLanguage = async (languageId: string, values: SeoValues) => {
    const language = await updateLanguage.mutateAsync({ id: languageId, body: { config: languageSeoConfig(values) } });
    return seoValues(language.config?.seo);
  };

  return { saveProject, saveLanguage };
}

/**
 * Uploads one image to the site's files and resolves its URL. Class:
 * server-confirmed (the shared hook presigns, PUTs and confirms). It saves no
 * configuration; the caller puts the URL in its draft. Each call settles on
 * its own promise and rejects on failure; the caller owns the error.
 */
export function useUploadSocialImage(projectId: string) {
  const upload = useUploadAsset(projectId);
  return async (file: File) => (await upload.mutateAsync(file)).url;
}
