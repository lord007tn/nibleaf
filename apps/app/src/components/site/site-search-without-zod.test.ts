import { expect, it, vi } from 'vitest';

// Opening search on a published docs page loads the search dialog and its query
// hook. Neither may import zod: docs pages keep zod out of their entry, so any
// zod import here would be fetched on the reader's first search open (#836).
// The API validates the query on the server.
vi.mock('zod', () => {
  throw new Error('the search dialog imported zod');
});
vi.mock('zod/v4', () => {
  throw new Error('the search dialog imported zod/v4');
});
vi.mock('zod/v4/core', () => {
  throw new Error('the search dialog imported zod/v4/core');
});
vi.mock('zod/mini', () => {
  throw new Error('the search dialog imported zod/mini');
});
// Server-only: reached through `createIsomorphicFn().server(...)` in
// services/api-origin.ts, which the Start compiler removes from client builds
// and vitest does not.
vi.mock('@/env.server', () => ({ serverEnv: {} }));

it('loads the search dialog and its query hook without zod', async () => {
  await expect(import('./site-search-dialog')).resolves.toHaveProperty('default');
  await expect(import('@/hooks/api/site-search')).resolves.toHaveProperty('useSiteSearch');
  await expect(import('@/functions/site-search')).resolves.toHaveProperty('searchSiteFn');
}, 30_000);
