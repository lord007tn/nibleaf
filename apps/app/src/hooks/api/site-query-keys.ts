/** The reader's query keys that the search hook and the dashboard share (a
 * published page's own key is `sitePageQueryKey`, in site-query-options.ts).
 * Kept apart from the app-wide factory (query-keys.ts) and free of imports, so
 * neither published pages nor dashboard modules load more than these lines. */
export const siteQueryKeys = {
  shell: (id: string, lang?: string, version?: string) => ['site', id, lang ?? null, version ?? null] as const,
  search: (id: string, q: string, lang?: string, version?: string, limit?: number, prefer?: string) =>
    ['site', id, 'search', q, lang ?? null, version ?? null, limit ?? null, prefer ?? null] as const,
  /** Prefix of every reader search for one site, for invalidation. */
  allSearch: (id: string) => ['site', id, 'search'] as const,
  changelog: (id: string) => ['site', id, 'changelog'] as const,
};
