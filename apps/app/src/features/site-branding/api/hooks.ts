import { useUpdateProjectConfig, useUploadAsset } from '@/hooks/api';
import { type BrandingValues, brandingUpdate, brandingValues } from '../model/branding';

/**
 * Saves the Branding form as one `config.branding` patch. Class: form save
 * (operations/ui-overhaul.md §8.2). It is not optimistic; the mutation
 * invalidates the project detail and list.
 *
 * `save` resolves with the branding values the server now holds, read from the
 * updated project it returns, and rejects on failure so the form stays dirty.
 * The caller owns the error: the mutation sets no `meta.errorMessage`, so the
 * global cache stays quiet.
 */
export function useSaveBranding(projectId: string) {
  const update = useUpdateProjectConfig(projectId);
  const save = async (baseline: BrandingValues, submitted: BrandingValues) => {
    const project = await update.mutateAsync({ config: { branding: brandingUpdate(baseline, submitted) } });
    return brandingValues(project.config);
  };
  return { save };
}

/**
 * Uploads one image to the site's files and resolves its URL. Class:
 * server-confirmed: the shared upload hook presigns, PUTs and confirms, and
 * keeps one storage attempt per File so a retry of the same File never stores
 * it twice. It saves no configuration; the caller puts the URL in its draft.
 *
 * Each call settles on its own promise (`mutateAsync`), so uploads for
 * different fields can overlap without one's result reaching another's
 * callbacks. It rejects on failure; the mutation sets no `meta.errorMessage`,
 * so the caller owns the error.
 */
export function useUploadBrandingImage(projectId: string) {
  const upload = useUploadAsset(projectId);
  return async (file: File) => (await upload.mutateAsync(file)).url;
}
