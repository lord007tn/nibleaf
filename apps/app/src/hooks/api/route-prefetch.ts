import type { QueryClient } from '@tanstack/react-query';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { branchesQueryOptions, languagesQueryOptions, pagesQueryOptions } from './query-options';

/*
 * Loader helpers that need more than one factory. Loader-safe like
 * ./query-options (no i18n, mutations or components), and not re-exported from
 * the `@/hooks/api` barrel: import from '@/hooks/api/route-prefetch'.
 */

/** The language or branch a screen opens on when the address doesn't name one:
 *  the default one, else the first. */
export const defaultScopeId = (items: ReadonlyArray<{ id: string; isDefault: boolean }> | undefined): string | undefined =>
  (items?.find((item) => item.isDefault) ?? items?.[0])?.id;

/**
 * Prefetch the page list a screen opens on. Lists are keyed by language and
 * branch, so when the address doesn't name them, the default ones are resolved
 * from the (usually already cached) language and branch lists first. Never
 * blocks the navigation and never throws; skipped during server rendering like
 * `prefetchRouteData`.
 *
 * `languageId: 'all'` lists every language (the editor's tree).
 */
export function prefetchScopedPages(
  queryClient: QueryClient,
  projectId: string,
  { languageId, branchId }: { languageId?: string | 'all'; branchId?: string },
): void {
  if (typeof window === 'undefined') return;
  const resolve = async () => {
    const [languages, branches] = await Promise.all([
      languageId ? undefined : queryClient.ensureQueryData(languagesQueryOptions(projectId)),
      branchId ? undefined : queryClient.ensureQueryData(branchesQueryOptions(projectId)),
    ]);
    const language = languageId === 'all' ? undefined : (languageId ?? defaultScopeId(languages));
    prefetchRouteData(queryClient, pagesQueryOptions(projectId, language, branchId ?? defaultScopeId(branches)));
  };
  void resolve().catch(() => undefined);
}
