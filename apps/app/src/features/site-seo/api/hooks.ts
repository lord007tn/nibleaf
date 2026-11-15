import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useLanguages, useUpdateLanguage, useUpdateProjectConfig, useUploadAsset } from '@/hooks/api';
import { languagesQueryOptions, projectQueryOptions } from '@/hooks/api/query-options';
import { languageSeoConfig, projectSeoPatch, type SeoValues, seoValues } from '../model/seo';

/** The site's languages: every non-default one is an SEO scope. */
export const useSeoLanguages = (projectId: string) => useLanguages(projectId);

/**
 * Saves one SEO scope. Class: form save (operations/ui-overhaul.md §8.2), not
 * optimistic. The project save invalidates the project (detail and list), a
 * language save the language list; each mutation resolves only after that
 * refetch, and then with its PATCH response.
 *
 * Each resolves the SEO values the server holds now: the scope as the refetch
 * read it, when a refetch succeeded after this save started, since that read
 * is newer than the PATCH response (someone else may have saved in between);
 * otherwise the PATCH response. So the form's confirmed baseline never rewinds
 * behind a refetch it already received. Each rejects on failure so the form
 * keeps its draft; neither mutation sets `meta.errorMessage`, so the caller
 * owns the error.
 */
export function useSaveSeo(projectId: string) {
  const queryClient = useQueryClient();
  const updateProject = useUpdateProjectConfig(projectId);
  const updateLanguage = useUpdateLanguage(projectId);

  /** The query's data if a fetch completed after `since` and nothing has invalidated it since. */
  const refetchedSince = <T>(queryKey: QueryKey, since: number) => {
    const state = queryClient.getQueryState<T>(queryKey);
    return state && !state.isInvalidated && state.dataUpdatedAt >= since ? state.data : undefined;
  };

  const saveProject = async (values: SeoValues) => {
    const since = Date.now();
    const project = await updateProject.mutateAsync({ config: { seo: projectSeoPatch(values) } });
    const refetched = refetchedSince<typeof project>(projectQueryOptions(projectId).queryKey, since);
    return seoValues((refetched ?? project).config?.seo);
  };

  const saveLanguage = async (languageId: string, values: SeoValues) => {
    const since = Date.now();
    const language = await updateLanguage.mutateAsync({ id: languageId, body: { config: languageSeoConfig(values) } });
    const refetched = refetchedSince<Array<typeof language>>(languagesQueryOptions(projectId).queryKey, since)?.find(
      (item) => item.id === languageId,
    );
    return seoValues((refetched ?? language).config?.seo);
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
