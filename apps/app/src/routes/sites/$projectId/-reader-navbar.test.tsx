// @vitest-environment jsdom
import { mergeLanguageChrome } from '@nibleaf/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SitePage, SiteShell } from '@/hooks/api/types';

const mocks = vi.hoisted(() => ({ getSite: vi.fn(), getSitePage: vi.fn(), listChangelog: vi.fn() }));
vi.mock('@/functions/site', () => ({ getSiteFn: mocks.getSite, getSitePageFn: mocks.getSitePage, listSiteChangelogFn: mocks.listChangelog }));
vi.mock('@/lib/site-redirects', () => ({ redirectIfConfigured: async () => undefined }));
vi.mock('@/lib/site-origin', () => ({ customDomainOrigin: () => null }));
vi.mock('@/providers/site-analytics-provider', () => ({
  SiteAnalyticsProvider: ({ children }: { children: unknown }) => children,
  useSiteAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@/components/site/site-analytics-consent', () => ({ SiteAnalyticsConsent: () => null, PrivacyChoicesLink: () => null }));

import { Route as SplatRoute } from './$';
import { Route as SiteRoute } from './route';

/**
 * What the published site's navbar shows for a stored navbar, as the Navbar
 * form now leaves it: a cleared CTA text is stored as '' (see
 * `features/site-navbar`), and a language override is replaced whole or
 * cleared with `navbar: null`. The shell carries the project config with the
 * active language's chrome laid over it by the real `mergeLanguageChrome`, as
 * the site API does (`apps/server/src/actions/sites.ts`). Reader code is
 * unchanged; this pins how it reads what the form stores.
 */
const PATH = 'start';
const NAVBAR = {
  ctaLabel: 'Book a demo',
  ctaUrl: '/demo',
  links: [{ label: 'Blog', href: 'https://blog.example.com', external: true }],
  tabs: [{ label: 'Guides', href: '/guides' }],
};

let projectConfig: Record<string, unknown> = {};
let languageConfig: Record<string, unknown> | null = null;

const shell = (activeLanguage: string): SiteShell =>
  ({
    project: {
      id: 'docs',
      name: 'Acme',
      slug: 'docs',
      description: null,
      config: activeLanguage === 'ar' ? mergeLanguageChrome(projectConfig, languageConfig as never) : projectConfig,
      primaryDomain: null,
    },
    nav: [{ id: 'p', kind: 'PAGE', title: 'Start', path: PATH, icon: null, tag: null, children: [] }],
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false },
    ],
    versions: [{ id: 'v', name: 'main', slug: 'main', isDefault: true }],
    activeLanguage,
    activeVersion: 'main',
    languageConfig: activeLanguage === 'ar' ? languageConfig : null,
    version: 1,
    generatedAt: '2026-11-01T00:00:00.000Z',
  }) as SiteShell;

const page = (activeLanguage: string): SitePage =>
  ({
    project: shell(activeLanguage).project,
    page: {
      id: 'page-1',
      createdAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z',
      title: 'Start',
      description: null,
      excerpt: '',
      icon: null,
      path: PATH,
      content: 'Welcome.',
      headings: [],
      config: null,
    },
    activeLanguage,
    activeVersion: 'main',
    versions: shell(activeLanguage).versions,
    languageConfig: null,
    languages: [
      { code: 'en', isDefault: true, path: PATH },
      { code: 'ar', isDefault: false, path: PATH },
    ],
    breadcrumbs: [{ title: 'Start', path: PATH }],
    prev: null,
    next: null,
  }) as SitePage;

const rootRoute = createRootRoute({ component: Outlet });
const siteRoute = SiteRoute.update({ id: '/sites/$projectId', path: '/sites/$projectId', getParentRoute: () => rootRoute } as never);
const splatRoute = SplatRoute.update({ id: '/$', path: '/$', getParentRoute: () => siteRoute } as never);
const routeTree = rootRoute.addChildren([siteRoute.addChildren([splatRoute])]);
let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.getAnimations = vi.fn(() => []);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  // The router restores scroll on navigation; jsdom has no layout to scroll.
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  localStorage.clear();
  projectConfig = {};
  languageConfig = null;
  mocks.getSite.mockImplementation(async ({ data }: { data: { language?: string } }) => shell(data.language ?? 'en'));
  mocks.getSitePage.mockImplementation(async ({ data }: { data: { language?: string } }) => page(data.language ?? 'en'));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Opens the page and reads its header: the CTA, the header links and the tabs, as [label, href]. */
async function navbarOf(navbar: Record<string, unknown>, language = 'en') {
  if (root) await act(async () => root?.unmount());
  projectConfig = { navbar };
  const url = `/sites/docs/${PATH}${language === 'en' ? '' : `?lang=${language}`}`;
  window.history.replaceState(null, '', url);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<RouterProvider router={router} />));
  await vi.waitFor(() => expect(container.querySelector('article h1')).not.toBeNull(), { timeout: 15_000 });
  const pair = (link: Element) => [link.textContent?.trim(), link.getAttribute('href')];
  const header = container.querySelector('header');
  const cta = header?.querySelector('a[data-analytics-placement="navbar"]');
  return {
    cta: cta ? pair(cta) : null,
    links: [...(header?.querySelectorAll('a[target="_blank"]:not([data-analytics-cta])') ?? [])].map(pair),
    tabs: [...container.querySelectorAll('[data-theme-region="tabs"] a')].map(pair),
  };
}

describe('the published navbar reads what the Navbar form stores', () => {
  it('shows the CTA when both texts are set, and resolves a root-relative address to the site', async () => {
    const seen = await navbarOf(NAVBAR);
    expect(seen.cta).toEqual(['Book a demo', '/sites/docs/demo']);
    expect(seen.tabs).toEqual([['Guides', '/sites/docs/guides']]);
    expect(seen.links).toEqual([['Blog', 'https://blog.example.com']]);
  }, 30_000);

  it.each([
    ['ctaLabel', ''],
    ['ctaUrl', ''],
    ['ctaLabel', undefined],
  ] as const)(
    '%s stored as %j hides the CTA, as one never set does; the lists stay',
    async (key, value) => {
      const seen = await navbarOf({ ...NAVBAR, [key]: value });
      expect(seen.cta).toBeNull();
      expect(seen.tabs).toHaveLength(1);
    },
    30_000,
  );

  it('emptied lists ([]) show no tabs and no links', async () => {
    expect(await navbarOf({ ...NAVBAR, links: [], tabs: [], anchors: [] })).toMatchObject({ links: [], tabs: [] });
  }, 30_000);

  it("a language's override replaces the lists and label it sets, with its addresses in that language", async () => {
    languageConfig = { navbar: { ctaLabel: 'احجز', tabs: [{ label: 'الأدلة', href: '/guides' }] }, seo: { metaTitle: 'توثيق' } };
    const seen = await navbarOf(NAVBAR, 'ar');
    // The global CTA URL and the project's links stay; root-relative addresses take the language's prefix.
    expect(seen).toStrictEqual({
      cta: ['احجز', '/sites/docs/ar/demo'],
      links: [['Blog', 'https://blog.example.com']],
      tabs: [['الأدلة', '/sites/docs/ar/guides']],
    });
  }, 30_000);

  it("a cleared override (navbar: null) falls back to the project's navbar", async () => {
    // What the server keeps after `{ config: { navbar: null } }`: the other sections, no navbar.
    languageConfig = { seo: { metaTitle: 'توثيق' } };
    const seen = await navbarOf(NAVBAR, 'ar');
    expect(seen.cta?.[0]).toBe('Book a demo');
    expect(seen.tabs.map(([label]) => label)).toEqual(['Guides']);
  }, 30_000);
});
