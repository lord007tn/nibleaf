import { queryOptions } from '@tanstack/react-query';
import { getSitePageFn } from '@/functions/site';
import { queryKeys } from './query-keys';

/*
 * Query factories for the published reader. Kept apart from the dashboard's
 * query-options.ts and as light as it: the reader's route loaders import this
 * module, so it ships in the public docs' first load. See apps/app/DATA_LOADING.md.
 */

/**
 * One published page. Reader loaders read it with
 * `queryClient.ensureQueryData(...)` (awaited, unlike the dashboard's
 * `prefetchRouteData`) because the article and its SEO tags must be in the
 * server-rendered HTML. In the browser, link-hover preloads and the click that
 * follows share this cache entry, so an opened page appears without a second
 * request.
 */
export const sitePageQueryOptions = (projectId: string, path: string, language?: string, version?: string) =>
  queryOptions({
    queryKey: queryKeys.site.page(projectId, path, language, version),
    queryFn: () => getSitePageFn({ data: { projectId, path, language, version } }),
  });
