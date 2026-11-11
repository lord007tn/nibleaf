import { queryOptions } from '@tanstack/react-query';
import { getSitePageFn } from '@/functions/site';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { PageTransportError } from '@/lib/page-load-error';
import { queryKeys } from './query-keys';

/*
 * Query factories for the published reader. Kept apart from the dashboard's
 * query-options.ts and as light as it: the reader's route loaders import this
 * module, so it ships in the public docs' first load. See apps/app/DATA_LOADING.md.
 */

/**
 * One published page. Reader loaders read it with `queryClient.query(...)`
 * (awaited, unlike the dashboard's `prefetchRouteData`) because the article and
 * its SEO tags must be in the server-rendered HTML. In the browser, a link-hover
 * preload and the click that follows share this cache entry while it is fresh, so
 * an opened page appears without a second request; a stale entry is fetched
 * again before the page shows, because the article renders the loader's result.
 *
 * `fresh: false` (private and reader-only sites, see lib/reader-site-access.ts)
 * makes every read load the page again, so access is checked on each navigation.
 *
 * A request that fails before the app answers with a structured API error (the
 * network dropped it, or a gateway answered with a bare 5xx) is reported as a
 * PageTransportError with its status and Retry-After, so the reader's
 * navigation fallback can tell a gateway hiccup from a refusal.
 */
export const sitePageQueryOptions = (projectId: string, path: string, language?: string, version?: string, { fresh = true } = {}) =>
  queryOptions({
    queryKey: queryKeys.site.page(projectId, path, language, version),
    ...(fresh ? {} : { staleTime: 0 }),
    queryFn: async () => {
      let answered: { status: number; retryAfter?: string } | undefined;
      const trackedFetch: typeof fetch = async (input, init) => {
        let response: Response;
        try {
          response = await fetch(input, init);
        } catch (error) {
          throw new PageTransportError(0, undefined, error);
        }
        answered = { status: response.status, retryAfter: response.headers.get('retry-after') ?? undefined };
        return response;
      };
      try {
        return await getSitePageFn({ data: { projectId, path, language, version }, fetch: trackedFetch });
      } catch (error) {
        // Structured API errors (404s, 403s, 429s, 5xx from the API), redirects
        // and not-founds keep their meaning; only a bare failed response is wrapped.
        if (!(error instanceof Error) || error instanceof ApiResponseError || !answered || answered.status < 400) throw error;
        throw new PageTransportError(answered.status, answered.retryAfter, error);
      }
    },
  });
