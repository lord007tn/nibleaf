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

Dashboard and sign-in loaders load with their route (`splitBehavior` in `vite.config.ts`), so they stay out of
published docs pages. Every other route option (`validateSearch`, `beforeLoad`, `head`, anything the route file
exports) and loaders outside the dashboard ship in every page's first load, the public reader's included. So keep
`validateSearch` to small, icon-free checks, and import loader factories from a module with no i18n or components
(`query-options.ts`, `analytics/query-options.ts`, `analytics/insights.ts`), never from a barrel that also exports
hooks calling `useT()`, which pulls in the whole dashboard message catalog. `BUNDLE_ANALYZE=true pnpm --filter
@nibleaf/app build && pnpm --filter @nibleaf/app bundle:check` catches both (see `BUNDLE_BUDGET.md`).

### Published reader pages (server-rendered)

The public reader is the exception: a page's content and SEO tags must be in the server-rendered HTML, so its loaders
`await queryClient.query(sitePageQueryOptions(...))` and the component reads the loader's result. The router dehydrates
loader data, so hydration matches. In the browser, a link-hover preload and the click that follows share one cache entry,
and a page read moments ago opens at once. Not `ensureQueryData` with `revalidateIfStale`: its background refresh would
land in the cache, not in the loader data the article shows, so a stale page would be shown once more. The route's `pendingComponent`
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
  their own error. Never show raw server messages. On a mutation it may also be a function of the error, to word the
  message from what went wrong; it runs once for every failed call:

  ```ts
  meta: { errorMessage: (error) => friendlyErrorMessage(t, error, 'error.unexpected') },
  ```

- The whole-snapshot rollback above is right only when one write of that data can be in flight at a time. If writes
  can overlap, see the next section.

### Overlapping writes

When one person can fire several writes of the same data before the first answers (Resolve then Reopen on a comment,
marking rows read one after another, then "Mark all read"), the recipe above breaks:

- **A snapshot rollback undoes newer clicks.** Write A's snapshot was taken before write B's optimistic change, so A
  failing restores the data from before B too. Roll back **per item, by intent**, instead.
- **Per-call callbacks run only for the latest call.** `mutate(vars, { onError })` on a hook whose earlier call is still
  in flight drops the earlier call's callbacks, so its failure goes unreported. Report errors from `meta.errorMessage`
  (string or function), which runs for every failed call, and keep rollback in the hook's own `onError`/`onSettled`.
- **Order matters when the server stores what it is sent.** Give the writes a shared `scope: { id }`, so they run one
  after another in click order (each optimistic update still shows at once) and the last click is what's saved.
- **Refetch once, at the end.** An invalidation while a later write is still queued would briefly show the older answer:
  in `onSettled`, skip it while `queryClient.isMutating({ mutationKey }) > 1`.

Per-item rollback keeps a small record of what each write in flight claims, shared by every caller of the hook
(`overlappingWrites()` in `src/hooks/api/mutations.ts` holds one per query client, plus a `token` per write):

```ts
onMutate: async ({ id, resolved }) => {
  const byId = intents.of(queryClient);
  const entry = byId.get(id) ?? { confirmed: currentValue(id), pending: [] };
  const token = intents.nextToken();
  entry.pending.push({ token, resolved }); // before any await, so the list follows click order
  byId.set(id, entry); // save it: onSettled needs it to undo a failed write
  // …cancel queries, then show the newest pending value (or `confirmed`)
  return { token };
},
onSettled: (_data, error, { id, resolved }, context) => {
  // Drop this write; a success becomes the confirmed value. Only a failure can change what's shown,
  // and only if it was the newest click: show the newest pending value again, else the confirmed one.
},
```

The two reference hooks:

- `useResolveComment`: one boolean per comment. Shows the newest click still in flight, else the value the server last
  confirmed, so an older failure never undoes a later Resolve or Reopen.
- `useMarkNotificationsRead`: rows claimed by several writes, plus a count. A failed row goes back to unread only when no
  other write still claims it and no finished write made it read. The count is never rolled back: the bell polls it on
  its own, so the cached number may already be the server's answer, and that answer may or may not include a write
  that hasn't answered yet. Any inverse change could be wrong either way. Once the last write has finished, the count is
  refetched instead.

Rule of thumb: roll back per item only for values you set yourself. For an aggregate that something else can refetch
(a count, a total), don't compute an inverse; refetch it when the writes are done.

If the outcome is monotonic and nothing depends on a local rollback, the simpler correct option is no rollback at all:
on failure, toast and invalidate.
