import { isNotFound } from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';
import { useCasesAr } from '@/components/marketing/copy/use-cases.ar';
import { useCasesEn } from '@/components/marketing/copy/use-cases.en';

vi.mock('@/functions/marketing', () => ({ getGithubStarsFn: vi.fn(async () => 7) }));

import { Route as ArabicRoute } from '../ar/use-cases/$slug';
import { Route as EnglishRoute } from './$slug';

type Loader = (input: { params: { slug: string } }) => Promise<{ meta: { slug: string; title: string }; stars: number }>;
type Head = (input: { loaderData?: unknown }) => {
  meta?: Record<string, string>[];
  links?: { rel: string; hrefLang?: string; href: string }[];
  scripts?: { children: string }[];
};

describe.each([
  ['en', EnglishRoute, useCasesEn, 'en_US'],
  ['ar', ArabicRoute, useCasesAr, 'ar_AR'],
] as const)('%s use-case route', (lang, Route, copies, locale) => {
  const loader = Route.options.loader as unknown as Loader;
  const head = Route.options.head as unknown as Head;

  it.each(['unknown', 'Support-Teams', 'toString', 'support-teams.md'])('returns not found for slug %s', async (slug) => {
    const error = await loader({ params: { slug } }).catch((caught: unknown) => caught);
    expect(isNotFound(error)).toBe(true);
  });

  it('builds head metadata from the lazily loaded copy', async () => {
    const data = await loader({ params: { slug: 'support-teams' } });
    const copy = copies['support-teams'];
    expect(data.stars).toBe(7);
    expect(data.meta.title).toBe(copy.meta.title);

    const result = head({ loaderData: data });
    const path = `${lang === 'ar' ? '/ar' : ''}/use-cases/support-teams`;
    expect(result.meta).toContainEqual({ title: copy.meta.title });
    expect(result.meta).toContainEqual({ name: 'description', content: copy.meta.description });
    expect(result.meta).toContainEqual({ property: 'og:locale', content: locale });
    const links = result.links ?? [];
    expect(new URL(links.find((link) => link.rel === 'canonical')?.href ?? '').pathname).toBe(path);
    expect(links.filter((link) => link.rel === 'alternate').map((link) => [link.hrefLang, new URL(link.href).pathname])).toEqual([
      ['en', '/use-cases/support-teams'],
      ['ar', '/ar/use-cases/support-teams'],
      ['x-default', '/use-cases/support-teams'],
    ]);
    const breadcrumb = JSON.parse(result.scripts?.[0]?.children ?? '{}');
    expect(breadcrumb['@type']).toBe('BreadcrumbList');
    expect(breadcrumb.itemListElement.map((item: { name: string; item: string }) => [item.name, new URL(item.item).pathname])).toEqual([
      [lang === 'ar' ? 'الرئيسية' : 'Home', lang === 'ar' ? '/ar' : '/'],
      [copy.navLabel, path],
    ]);
  });

  it('renders an empty head without loader data', () => {
    expect(head({})).toEqual({});
  });
});
