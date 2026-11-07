import { describe, expect, it, vi } from 'vitest';

vi.mock('@/functions/marketing', () => ({ getGithubStarsFn: vi.fn(async () => 7) }));

import { Route as arabicRoute } from './ar/documentation-platforms';
import { Route as englishRoute } from './documentation-platforms';

type Head = { links: Record<string, string>[]; scripts: { children: string }[] };
const headFrom = (route: { options: unknown }) => async () => {
  const { loader, head } = route.options as { loader: () => Promise<unknown>; head: (input: { loaderData: unknown }) => Head };
  return head({ loaderData: await loader() });
};
const englishHead = headFrom(englishRoute);
const arabicHead = headFrom(arabicRoute);

describe('documentation platform route language pair', () => {
  it.each([
    ['en', englishHead, '/documentation-platforms'],
    ['ar', arabicHead, '/ar/documentation-platforms'],
  ] as const)('emits a self canonical and reciprocal alternates for %s', async (_locale, headFactory, selfPath) => {
    const links = (await headFactory()).links;
    expect(links).toContainEqual({ rel: 'canonical', href: expect.stringMatching(`${selfPath}$`) });
    expect(links).toContainEqual({ rel: 'alternate', hrefLang: 'en', href: expect.stringMatching('/documentation-platforms$') });
    expect(links).toContainEqual({ rel: 'alternate', hrefLang: 'ar', href: expect.stringMatching('/ar/documentation-platforms$') });
    expect(links).toContainEqual({ rel: 'alternate', hrefLang: 'x-default', href: expect.stringMatching('/documentation-platforms$') });
  });

  it.each([
    ['en', englishHead],
    ['ar', arabicHead],
  ] as const)('emits the six-platform ItemList for %s', async (locale, headFactory) => {
    const script = (await headFactory()).scripts.find((candidate) => JSON.parse(candidate.children)['@type'] === 'ItemList');
    expect(script).toBeDefined();
    const itemList = JSON.parse(script?.children ?? '{}') as {
      inLanguage: string;
      numberOfItems: number;
      itemListElement: unknown[];
    };

    expect(itemList.inLanguage).toBe(locale);
    expect(itemList.numberOfItems).toBe(6);
    expect(itemList.itemListElement).toHaveLength(6);
  });
});
