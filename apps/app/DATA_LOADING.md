# Data loading, loading states and skeletons

How the dashboard loads data and shows that it is loading. New screens and changes to existing ones should follow these
patterns; reviewers can link here.

## The rules

1. **One QueryClient, from the router.** `getRouter()` creates it (`createQueryClient()` in
   `src/integrations/tanstack-query/query-client.ts`) and provides it to every route: components through
   `QueryClientProvider`, loaders through `context.queryClient`. Never mount another `QueryClientProvider`.
2. **Every query has a `queryOptions()` factory** in `src/hooks/api/*`, keyed with `queryKeys`. Hooks are thin wrappers:
   `useQuery(fooQueryOptions(id))`. Loaders prefetch the same factory, so keys can't drift.
3. **Routes prefetch in their loader**, without blocking: `prefetchRouteData(context.queryClient, fooQueryOptions(id))`.
   With `defaultPreload: 'intent'` this starts on link hover. The page renders its skeleton immediately.
4. **First load shows a skeleton shaped like the content** (`@nibleaf/design-system/components/ui/skeleton`), never a
   bare "Loading…" or a spinner in an empty page. Background refetches show nothing (or a subtle indicator).
5. **Every async button uses `loading`** — `<Button loading={mutation.isPending}>Save</Button>` — instead of swapping its
   text or disabling it by hand.
6. **Mutations invalidate through `queryKeys`**, update optimistically only when the server outcome is predictable (and
   roll back on error), and report failures in plain language.
7. **No fetching in `useEffect`.** If you need data, it's a query; if you need to react to a change, it's a mutation or
   an event handler.

## Query client defaults

| Option | Default | Why |
| --- | --- | --- |
| `staleTime` | 30 s | Dashboard data changes when *you* change it, and mutations invalidate what they touch. |
| `gcTime` | 5 min | Going back to a screen is instant. |
| `retry` | `shouldRetry` — up to 2 retries for network and 5xx failures, **never for 4xx** | Bad input, signed out, forbidden or not found won't change on retry. |
| `refetchOnWindowFocus` | `false` | The editor keeps local drafts; a focus refetch mid-edit would race them. Opt in per query for shared lists. |
| `refetchOnReconnect` | `true` | Catch up after being offline. |
| mutations `retry` | `false` | Mutations aren't idempotent; let the person retry. |

Override per query only with a reason in a comment (for example `staleTime: 0` for the pending-changes check, which
must follow every autosave).

## Recipes

### A query factory and its hook

```ts
// src/hooks/api/queries.ts
export const domainsQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.domains.all(projectId ?? ''),
    // skipToken instead of `enabled: false`: the query is typed as disabled until there is an id.
    queryFn: projectId
      ? async () => getData<Domain[]>(await api.app.projects[':projectId'].domains.$get({ param: { projectId } }), 'domains')
      : skipToken,
  });

export const useDomains = (projectId: string | undefined) => useQuery(domainsQueryOptions(projectId));
```

Extra per-use options (polling, `select`) go on the hook, spread over the factory:

```ts
export const useDeployments = (projectId: string | undefined, options?: { pollIntervalMs?: number }) =>
  useQuery({ ...deploymentsQueryOptions(projectId), refetchInterval: (query) => (isBuilding(query.state.data) ? 2500 : false) });
```

### Prefetch in a route loader

```ts
export const Route = createFileRoute('/app/projects/$projectId')({
  loader: ({ context: { queryClient }, params: { projectId } }) => {
    prefetchRouteData(queryClient, projectQueryOptions(projectId));
    prefetchRouteData(queryClient, pagesQueryOptions(projectId));
  },
  component: ProjectRoute,
});
```

`prefetchRouteData` uses `ensureQueryData` (fresh cache is reused), never throws (the component's query shows the
error), and is skipped during server rendering: the dashboard doesn't dehydrate the query cache into the HTML, so data
fetched on the server would render markup the browser's empty cache can't match on hydration. Don't `await` it in a
loader — that would hold the navigation on the full-screen pending loader instead of the page skeleton.

### Published reader pages (server-rendered)

The public reader is the exception: a page's content and SEO tags must be in the server-rendered HTML, so its loaders
`await queryClient.ensureQueryData({ ...sitePageQueryOptions(...), revalidateIfStale: true })` and the component reads
the loader's result. The router dehydrates loader data, so hydration matches. In the browser, a link-hover preload and the
click that follows share one cache entry, and a page read moments ago opens at once. The route's `pendingComponent`
(`SiteArticleSkeleton`) keeps the reader chrome and shows an article-shaped placeholder. Factories the reader's loaders
import live in `src/hooks/api/site-query-options.ts`, which ships in the public first load: keep it as light as
`query-options.ts`.

### Skeletons

```tsx
import { SkeletonListRow, SkeletonStatTile, SkeletonTableRows, SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';

if (isPending) {
  return (
    <section aria-busy="true">
      <p className="sr-only" role="status">{t('common.loading')}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{tiles.map((id) => <SkeletonStatTile key={id} />)}</div>
      <table><tbody><SkeletonTableRows columns={4} rows={5} /></tbody></table>
    </section>
  );
}
```

- Match the real layout: same grid, same row height (`SkeletonListRow` is 48 px, `SkeletonTableRows` rows are 48 px),
  same number of columns. The swap to real content should not move anything.
- Blocks are `aria-hidden`; put `aria-busy` and one visually hidden status on the region instead.
- Pulsing stops for `prefers-reduced-motion` (built into `Skeleton`).
- Show a skeleton for `isPending` (no data yet), not for `isFetching` (refreshing data you already show).
- Paginated, filtered and search lists use `placeholderData: keepPreviousData`, so the current results stay on screen
  (dim them if you like) while the next ones load.

### Async buttons

```tsx
<Button loading={save.isPending} type="submit">{t('common.save')}</Button>
<Button disabled={!name.trim()} loading={create.isPending} loadingText={t('newSite.creating')} type="submit">
  {t('newSite.create')}
</Button>
```

`loading` disables the button, sets `aria-busy`, shows a spinner and keeps the button's width (the label stays in the
layout, invisible). Without `loadingText` the label remains the accessible name; with it, the loading text is shown and
announced. Pass `loading={false}` rather than leaving it undefined on buttons that can load, so the markup doesn't change
when loading starts. Icons keep their position; RTL is handled.

### Mutations

```ts
export const useRenamePage = (projectId: string) => {
  const queryClient = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => mutateData(await api.app.projects[':projectId'].pages[':id'].$patch({ param: { projectId, id }, json: { title } }), 'rename'),
    // Optimistic only because the outcome is predictable; roll back on error.
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
      const previous = queryClient.getQueriesData<PageNode[]>({ queryKey: queryKeys.pages.allForProject(projectId) });
      queryClient.setQueriesData<PageNode[]>({ queryKey: queryKeys.pages.allForProject(projectId) }, (pages) =>
        pages?.map((page) => (page.id === id ? { ...page, title } : page)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) }),
    // Plain-language toast from the shared MutationCache when the call fails.
    meta: { errorMessage: t('editor.renameFailed') },
  });
};
```

- Invalidate with the broad `queryKeys` prefix that covers every variant you touched (`allForProject`, not one
  language/branch key).
- `meta.errorMessage` (already translated) is toasted by the shared caches for queries and mutations that don't show
  their own error. Never show raw server messages.
