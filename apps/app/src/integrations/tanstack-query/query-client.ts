import { CancelledError, type EnsureQueryDataOptions, MutationCache, QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { getSessionGeneration } from './session-generation';

declare module '@tanstack/react-query' {
  interface Register {
    /**
     * `meta.errorMessage`: plain-language text (already translated with `t()` by
     * the hook) toasted when the query or mutation fails. Callers that handle
     * errors inline (an error state, their own `onError`) simply leave it out.
     * A mutation may pass a function to word the message from the error (for
     * example with `friendlyErrorMessage`); it runs once for every failed call.
     */
    queryMeta: { errorMessage?: string };
    mutationMeta: { errorMessage?: string | ((error: unknown) => string); sessionGeneration?: number };
  }
}

/** 4xx answers (bad input, signed out, forbidden, not found, conflict) won't change on retry. */
export const isClientError = (error: unknown): boolean => error instanceof ApiResponseError && error.status >= 400 && error.status < 500;

const MAX_RETRIES = 2;

/** Retry network and 5xx failures (twice, with the default backoff); never 4xx. */
export const shouldRetry = (failureCount: number, error: unknown): boolean => !isClientError(error) && failureCount < MAX_RETRIES;

// The router (and so this module) is in every page's bundle, including public
// marketing and reader pages: load the toast library only when a toast is due.
const toastError = (message: string | undefined, isCurrent: () => boolean = () => true) => {
  if (message)
    void import('sonner').then(({ toast }) => {
      if (isCurrent()) toast.error(message);
    });
};

/**
 * One QueryClient per router: per request on the server (no cross-request cache)
 * and one for the whole session in the browser, shared by every route through
 * the router context. See apps/app/DATA_LOADING.md for the conventions.
 */
export function createQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (_error, query) => toastError(query.meta?.errorMessage),
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (error instanceof CancelledError) return;
        const generation = mutation.meta?.sessionGeneration;
        const isCurrent = () => generation === undefined || generation === getSessionGeneration(queryClient);
        if (!isCurrent()) return;
        const message = mutation.meta?.errorMessage;
        toastError(typeof message === 'function' ? message(error) : message, isCurrent);
      },
    }),
    defaultOptions: {
      queries: {
        // Dashboard data changes when *you* change it, and mutations invalidate
        // what they touch, so 30 s of freshness avoids refetch storms on
        // navigation without showing stale data for long.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        // Off by default: the editor keeps local drafts, and a focus refetch of a
        // page mid-edit would race them. Opt in per query for shared lists.
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        // Mutations are not idempotent; let the person retry explicitly.
        retry: false,
      },
    },
  });
  return queryClient;
}

/**
 * Start loading a route's data as early as possible (on link hover with
 * `defaultPreload: 'intent'`, or on navigation) without blocking the
 * navigation: the page renders its skeleton immediately and fills in when the
 * data arrives. Skipped during server rendering, because the dashboard doesn't
 * dehydrate the query cache into the HTML — prefetching there would render data
 * the browser's empty cache can't match on hydration.
 */
export function prefetchRouteData<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>,
): void {
  if (typeof window === 'undefined') return;
  // ensureQueryData returns cached data when it's fresh and only fetches when it's
  // missing; a failure surfaces through the component's own query, not here.
  void queryClient.ensureQueryData(options).catch(() => undefined);
}
