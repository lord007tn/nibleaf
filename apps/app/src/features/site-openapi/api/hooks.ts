import { useQueryClient } from '@tanstack/react-query';
import { type OpenApiConfiguration, useDeleteOpenApi, useOpenApiConfiguration, useSyncOpenApi, useUpsertOpenApi } from '@/hooks/api';
import { queryKeys } from '@/hooks/api/query-keys';
import type { OpenApiSource } from '../model/openapi';

/** The site's OpenAPI reference, or `null` when it has none (shared with the route loader). */
export const useSiteOpenApi = (projectId: string) => useOpenApiConfiguration(projectId);

/*
 * The three mutations below set no `meta.errorMessage`, so the shared client
 * stays quiet: the OpenAPI section is the one place each failure is toasted.
 * Each invalidates the configuration on success, and `mutateAsync` resolves
 * once that refetch has settled.
 */

/**
 * Saves the form (title, path and, when one was given, the source). Class:
 * form save (operations/ui-overhaul.md §8.2), not optimistic. Rejects on
 * failure; the caller owns the error.
 *
 * The response carries no configuration, so `save` resolves to what the
 * refetch that followed brought back: the server's own values, normalized
 * its way. It resolves to `undefined` when the cache wasn't refreshed after
 * the save started (the refetch failed), so the caller falls back to what it
 * sent.
 */
export function useSaveSiteOpenApi(projectId: string) {
  const upsert = useUpsertOpenApi(projectId);
  const queryClient = useQueryClient();
  const save = async (body: { title: string; path: string; source?: OpenApiSource }): Promise<OpenApiConfiguration | null | undefined> => {
    const startedAt = Date.now();
    await upsert.mutateAsync(body);
    const state = queryClient.getQueryState<OpenApiConfiguration | null>(queryKeys.openapi.detail(projectId));
    return state && state.status === 'success' && state.dataUpdatedAt >= startedAt ? state.data : undefined;
  };
  return { save, isPending: upsert.isPending };
}

/** Fetches a URL or repository source again. Class: server-confirmed (§8.2). */
export const useSyncSiteOpenApi = (projectId: string) => useSyncOpenApi(projectId);

/** Removes the reference. Class: server-confirmed (§8.2), after a confirmation. */
export const useRemoveSiteOpenApi = (projectId: string) => useDeleteOpenApi(projectId);
