import { type AnyRouteMatch, notFound } from '@tanstack/react-router';
import { type ComponentType, lazy, Suspense } from 'react';
import { MarketingDataContext, type MarketingLoadInput } from './page-data';

/**
 * The marketing site's own route table (#345).
 *
 * Every route's definition ships in the router's eager chunk, which every
 * published docs page loads. So the router holds only a few thin marketing
 * routes (`/`, `/$page`, `/blog/$slug`, `/compare/$slug`, …), and they dispatch
 * here by pathname. This module loads with those routes, never with a docs
 * page, and each page's own module loads only when that page is visited.
 *
 * A page module exports `load` (its loader: data plus the `head` it renders)
 * and `Page` (its component, which reads that data with `useMarketingData`).
 * URLs, heads and the sitemap (`lib/marketing-sitemap.ts`) are unchanged.
 */
interface MarketingPageModule {
  load: (input: MarketingLoadInput) => Promise<object>;
  Page: ComponentType;
}

interface MarketingRouteEntry {
  /** The URL path; `$name` matches one segment into `params.name`. */
  path: string;
  module: () => Promise<MarketingPageModule>;
}

export const MARKETING_ROUTES: readonly MarketingRouteEntry[] = [
  { path: '/', module: () => import('./pages/landing') },
  { path: '/ar', module: () => import('./pages/ar-landing') },
  { path: '/about', module: () => import('./pages/about') },
  { path: '/blog', module: () => import('./pages/blog-index') },
  { path: '/blog/$slug', module: () => import('./pages/blog-article') },
  { path: '/cloud', module: () => import('./pages/cloud') },
  { path: '/contact', module: () => import('./pages/contact') },
  { path: '/developers', module: () => import('./pages/developers') },
  { path: '/documentation-platforms', module: () => import('./pages/documentation-platforms') },
  { path: '/guides', module: () => import('./pages/guides') },
  { path: '/pricing', module: () => import('./pages/pricing') },
  { path: '/privacy', module: () => import('./pages/privacy') },
  { path: '/self-hosting', module: () => import('./pages/self-hosting') },
  { path: '/terms', module: () => import('./pages/terms') },
  { path: '/use-cases/$slug', module: () => import('./pages/use-case') },
  { path: '/tools/rtl-documentation-readiness', module: () => import('./pages/tools-rtl-documentation-readiness') },
  { path: '/compare/nibleaf-vs-mintlify', module: () => import('./pages/compare-nibleaf-vs-mintlify') },
  { path: '/compare/nibleaf-vs-gitbook', module: () => import('./pages/compare-nibleaf-vs-gitbook') },
  { path: '/compare/nibleaf-vs-docusaurus', module: () => import('./pages/compare-nibleaf-vs-docusaurus') },
  { path: '/alternatives/mintlify', module: () => import('./pages/alternatives-mintlify') },
  { path: '/alternatives/gitbook', module: () => import('./pages/alternatives-gitbook') },
  { path: '/alternatives/readme', module: () => import('./pages/alternatives-readme') },
  { path: '/ar/documentation-platforms', module: () => import('./pages/ar-documentation-platforms') },
  { path: '/ar/guides', module: () => import('./pages/ar-guides') },
  { path: '/ar/use-cases/$slug', module: () => import('./pages/ar-use-case') },
];

const segmentsOf = (path: string) => path.split('/').filter(Boolean);

/** The entry for `pathname` and its parameters, matched as the router matched
 *  the old file routes: static segments ignore case and a trailing slash. */
export const matchMarketingRoute = (pathname: string): { route: MarketingRouteEntry; params: Record<string, string> } | null => {
  const segments = segmentsOf(pathname);
  for (const route of MARKETING_ROUTES) {
    const pattern = segmentsOf(route.path);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const matches = pattern.every((part, index) => {
      const segment = segments[index] ?? '';
      if (part.startsWith('$')) {
        try {
          params[part.slice(1)] = decodeURIComponent(segment);
        } catch {
          return false;
        }
        return true;
      }
      return part === segment.toLowerCase();
    });
    if (matches) return { route, params };
  }
  return null;
};

export type MarketingHead = { meta?: AnyRouteMatch['meta']; links?: AnyRouteMatch['links']; scripts?: AnyRouteMatch['headScripts'] };

export type MarketingPageData = Record<string, unknown> & {
  head?: MarketingHead;
  marketingPath: string;
  marketingParams: Record<string, string>;
};

// Modules a loader has resolved here: the server renders them right away, and
// so does the client after a navigation.
const loaded = new Map<string, MarketingPageModule>();

/** The loader of every marketing route: the page's data, with its head and
 *  which entry rendered it. An unknown path is not found, as before. */
export const loadMarketingPage = async (pathname: string): Promise<MarketingPageData> => {
  const match = matchMarketingRoute(pathname);
  if (!match) throw notFound();
  const module = await match.route.module();
  loaded.set(match.route.path, module);
  const data = (await module.load({ params: match.params })) as Record<string, unknown> & { head?: MarketingHead };
  return { ...data, marketingPath: match.route.path, marketingParams: match.params };
};

// On first load the client hydrates before any loader runs here, so the page
// component loads lazily. Inside <Suspense>, React keeps the server's HTML on
// screen until that module arrives, then hydrates it.
const lazyPages = new Map<string, ComponentType>();
const pageComponent = (path: string): ComponentType | null => {
  const module = loaded.get(path);
  if (module) return module.Page;
  const known = lazyPages.get(path);
  if (known) return known;
  const route = MARKETING_ROUTES.find((entry) => entry.path === path);
  if (!route) return null;
  const page = lazy(() => route.module().then((resolved) => ({ default: resolved.Page })));
  lazyPages.set(path, page);
  return page;
};

/** Render the marketing page a route's loader resolved. */
export function MarketingPage({ data }: { data: MarketingPageData }) {
  const Page = pageComponent(data.marketingPath);
  if (!Page) return null;
  return (
    <MarketingDataContext value={{ data, params: data.marketingParams }}>
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    </MarketingDataContext>
  );
}
