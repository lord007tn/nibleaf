import { useDeleteOpenApi, useOpenApiConfiguration, useSyncOpenApi, useUpsertOpenApi } from '@/hooks/api';

/** The site's OpenAPI reference, or `null` when it has none (shared with the route loader). */
export const useSiteOpenApi = (projectId: string) => useOpenApiConfiguration(projectId);

/*
 * The three mutations below set no `meta.errorMessage`, so the shared client
 * stays quiet: the OpenAPI section is the one place each failure is toasted.
 * Each invalidates the configuration on success, and `mutateAsync` resolves
 * once that refetch has settled.
 */

/** Saves the form (title, path and, when one was given, the source). Class: form save (operations/ui-overhaul.md §8.2), not optimistic. */
export const useSaveSiteOpenApi = (projectId: string) => useUpsertOpenApi(projectId);

/** Fetches a URL or repository source again. Class: server-confirmed (§8.2). */
export const useSyncSiteOpenApi = (projectId: string) => useSyncOpenApi(projectId);

/** Removes the reference. Class: server-confirmed (§8.2), after a confirmation. */
export const useRemoveSiteOpenApi = (projectId: string) => useDeleteOpenApi(projectId);
