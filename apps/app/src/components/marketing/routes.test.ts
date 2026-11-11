import { readFileSync } from 'node:fs';
import { type AnyRoute, createMemoryHistory, createRootRoute, createRoute, createRouter, isNotFound } from '@tanstack/react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BLOG_ENTRIES } from '@/lib/blog';
import { MARKETING_SITEMAP, marketingSitemapEntries } from '@/lib/marketing-sitemap';
import { loadMarketingPage, MARKETING_ROUTES, matchMarketingRoute } from './routes';

vi.mock('@/functions/marketing', () => ({ getGithubStarsFn: vi.fn(async () => 7) }));
// Articles are MDX, which the unit-test build doesn't compile; heads don't need them.
vi.mock('@/lib/blog-components', () => ({ blogComponent: () => null }));

// The router routes that dispatch into the marketing table (#345).
const MARKETING_ROUTE_IDS = new Set([
  '/',
  '/$page',
  '/blog/$slug',
  '/compare/$slug',
  '/alternatives/$slug',
  '/use-cases/$slug',
  '/tools/$slug',
  '/ar/$page',
  '/ar/use-cases/$slug',
]);
/** The app's real route tree, rebuilt from routeTree.gen.ts (ids, paths and
 *  parents) as component-free routes, so the router's own matching runs on it
 *  without loading every page. */
const generatedTree = (): AnyRoute => {
  const source = readFileSync(new URL('../../routeTree.gen.ts', import.meta.url), 'utf8');
  const root = createRootRoute();
  const byName = new Map<string, AnyRoute>([['rootRouteImport', root]]);
  const children = new Map<AnyRoute, AnyRoute[]>();
  const pattern = /const (\w+) =\s*\w+\.update\(\{\s*id: '([^']*)',\s*(?:path: '([^']*)',\s*)?getParentRoute: \(\) => (\w+),/g;
  const entries = [...source.matchAll(pattern)];
  expect(entries.length).toBe(source.split('.update({').length - 1);
  const pending = [...entries];
  while (pending.length > 0) {
    const index = pending.findIndex((entry) => byName.has(entry[4] as string));
    if (index < 0) throw new Error('routeTree.gen.ts has a route whose parent is missing');
    const [, name, id, path, parentName] = pending.splice(index, 1)[0] as RegExpMatchArray;
    const parent = byName.get(parentName as string) as AnyRoute;
    const route = createRoute({ getParentRoute: () => parent, ...(path === undefined ? { id } : { path }) } as never) as unknown as AnyRoute;
    byName.set(name as string, route);
    children.set(parent, [...(children.get(parent) ?? []), route]);
  }
  const attach = (route: AnyRoute): AnyRoute => {
    const kids = children.get(route);
    return kids ? route.addChildren(kids.map(attach)) : route;
  };
  return attach(root);
};
const router = createRouter({ routeTree: generatedTree(), history: createMemoryHistory() });
const leafRouteId = (path: string) => router.matchRoutes(path, {}).at(-1)?.routeId as string | undefined;

type Link = { rel?: string; href?: string; hrefLang?: string };
type Meta = { property?: string; name?: string; content?: string; title?: string };
const sitemapPaths = marketingSitemapEntries().map((entry) => entry.path);

describe('marketing URLs (#345)', () => {
  it.each(sitemapPaths)('serves %s through a marketing route and its table entry', (path) => {
    expect(MARKETING_ROUTE_IDS.has(leafRouteId(path) ?? '')).toBe(true);
    expect(matchMarketingRoute(path)).not.toBeNull();
  });

  it('lists every static marketing page in the sitemap, and the sitemap lists no page the table lacks', () => {
    const staticPaths = MARKETING_ROUTES.map((route) => route.path).filter((path) => !path.includes('$'));
    const sitemapStatic = sitemapPaths.filter((path) => !matchMarketingRoute(path)?.route.path.includes('$'));
    expect([...staticPaths].sort()).toEqual([...sitemapStatic].sort());
    // Each use-case slug in the sitemap resolves to its page.
    expect(MARKETING_SITEMAP.filter((entry) => entry.path.includes('/use-cases/')).length).toBe(6);
    expect(BLOG_ENTRIES.every((entry) => matchMarketingRoute(`/blog/${entry.slug}`)?.route.path === '/blog/$slug')).toBe(true);
  });

  it('matches like the old file routes: case-insensitive static segments and a trailing slash', () => {
    expect(matchMarketingRoute('/Pricing/')?.route.path).toBe('/pricing');
    expect(matchMarketingRoute('/AR/Guides')?.route.path).toBe('/ar/guides');
    expect(matchMarketingRoute('/blog/Some-Slug')?.params).toEqual({ slug: 'Some-Slug' });
    expect(matchMarketingRoute('/ar/use-cases/support-teams')).toMatchObject({
      route: { path: '/ar/use-cases/$slug' },
      params: { slug: 'support-teams' },
    });
  });

  it.each(['/nope', '/compare/nibleaf-vs-nothing', '/ar/use-cases', '/tools/other', '/pricing/extra', '/blog/%E0%A4%A'])(
    'answers not found for %s',
    async (path) => {
      const error = await loadMarketingPage(path).catch((caught: unknown) => caught);
      expect(isNotFound(error)).toBe(true);
    },
  );

  it('leaves the dashboard, auth and reader routes where they were', () => {
    expect(leafRouteId('/app/xyz')).not.toBe('/$page');
    expect(MARKETING_ROUTE_IDS.has(leafRouteId('/app/xyz') ?? '')).toBe(false);
    expect(leafRouteId('/sign-in')).toBe('/(auth)/sign-in');
    expect(leafRouteId('/sites/abc/intro')).toBe('/sites/$projectId/$');
    expect(leafRouteId('/join/token')).toBe('/join/$token');
  });
});

describe('marketing heads (#345)', () => {
  // The first page loaded pays for importing the marketing pages, their SEO
  // helpers and the blog: about 2 s alone, and more than the default 5 s test
  // timeout when the whole suite runs in parallel. Load it once up front with
  // its own budget, so each case below measures only its own page.
  beforeAll(async () => {
    await loadMarketingPage('/');
  }, 60_000);

  it.each(sitemapPaths)('gives %s a canonical link and og:url for its own URL', async (path) => {
    const { head } = await loadMarketingPage(path);
    const links = (head?.links ?? []) as Link[];
    const canonical = links.filter((link) => link.rel === 'canonical');
    expect(canonical).toHaveLength(1);
    expect(new URL(canonical[0]?.href ?? '').pathname).toBe(path);
    const meta = (head?.meta ?? []) as Meta[];
    expect(meta.find((entry) => entry.property === 'og:url')?.content).toBe(canonical[0]?.href);
    expect(meta.some((entry) => entry.title)).toBe(true);
  });

  it('keeps the loader data the root route reads: an article’s language', async () => {
    const arabic = BLOG_ENTRIES.find((entry) => entry.language === 'ar');
    expect(arabic).toBeDefined();
    expect((await loadMarketingPage(`/blog/${arabic?.slug}`)).language).toBe('ar');
    expect(leafRouteId(`/blog/${arabic?.slug}`)).toBe('/blog/$slug');
  });
});
