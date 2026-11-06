/** @vitest-environment jsdom */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from './query-keys';
import { defaultScopeId, prefetchScopedPages } from './route-prefetch';

// The page-list fetch itself is not under test; it fails quietly (prefetches never throw).
vi.mock('@/services/api', () => ({ api: {} }));

const languages = [
  { id: 'lang-ar', isDefault: false },
  { id: 'lang-en', isDefault: true },
];
const branches = [
  { id: 'branch-v2', isDefault: false },
  { id: 'branch-main', isDefault: true },
];

/** A client with the scope lists cached, recording every key it is asked to ensure. */
function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.languages.all('p1'), languages);
  queryClient.setQueryData(queryKeys.branches.all('p1'), branches);
  const ensured: unknown[] = [];
  const ensure = queryClient.ensureQueryData.bind(queryClient);
  vi.spyOn(queryClient, 'ensureQueryData').mockImplementation((options) => {
    ensured.push(options.queryKey);
    return ensure(options);
  });
  return { queryClient, ensured };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('defaultScopeId', () => {
  it('prefers the default item, then the first, else nothing', () => {
    expect(defaultScopeId(languages)).toBe('lang-en');
    expect(defaultScopeId([{ id: 'only', isDefault: false }])).toBe('only');
    expect(defaultScopeId([])).toBeUndefined();
    expect(defaultScopeId(undefined)).toBeUndefined();
  });
});

describe('prefetchScopedPages', () => {
  it('prefetches the default language and branch the screen opens on', async () => {
    const { queryClient, ensured } = setup();
    prefetchScopedPages(queryClient, 'p1', {});
    await settle();
    expect(ensured).toContainEqual(queryKeys.pages.all('p1', 'lang-en', 'branch-main'));
  });

  it('keeps every language for the editor tree and honours a branch in the address', async () => {
    const { queryClient, ensured } = setup();
    prefetchScopedPages(queryClient, 'p1', { languageId: 'all', branchId: 'branch-v2' });
    await settle();
    expect(ensured).toContainEqual(queryKeys.pages.all('p1', undefined, 'branch-v2'));
    // Nothing to resolve: neither scope list is read.
    expect(ensured).not.toContainEqual(queryKeys.languages.all('p1'));
    expect(ensured).not.toContainEqual(queryKeys.branches.all('p1'));
  });
});
