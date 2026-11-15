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
 * What the published site's footer shows for a stored footer, as the Footer
 * form now leaves it: a cleared text is stored as '' (see
 * `features/site-footer`). The shell carries the project config with the
 * active language's chrome laid over it by the real `mergeLanguageChrome`, as
 * the site API does (`apps/server/src/actions/sites.ts`). Reader code is
 * unchanged; this pins how it reads what the form stores.
 */
const PATH = 'start';
const FULL = { copyright: '© Acme', github: 'https://github.com/acme', x: 'https://x.com/acme', linkedin: '/company' };
const SOCIAL = ['github', 'x', 'linkedin'] as const;
const AUTOMATIC = `© ${new Date().getFullYear()} Acme`;

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

/** Opens the page and reads its footer: the copyright line, the social links and whether the badge shows. */
async function footerOf(footer: Record<string, unknown>, language = 'en') {
  projectConfig = { footer };
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
  const element = container.querySelector('footer');
  const content = element?.querySelector('[data-theme-region="footer"]');
  return {
    copyright: content ? (content.querySelector(':scope > span')?.textContent ?? null) : null,
    links: [...(content?.querySelectorAll('a') ?? [])].map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]),
    badge: Boolean(element?.querySelector('a[href^="https://nibleaf.com/"]')),
  };
}

describe('the published footer reads what the Footer form stores', () => {
  it('a deliberately blank copyright beside social links shows an empty line, not the automatic one', async () => {
    const seen = await footerOf({ ...FULL, copyright: '' });
    expect(seen.copyright).toBe('');
    expect(seen.links.map(([label]) => label)).toEqual(['GitHub', 'X', 'LinkedIn']);
  }, 30_000);

  it('a copyright the site never set still shows the automatic line', async () => {
    expect((await footerOf({ ...FULL, copyright: undefined })).copyright).toBe(AUTOMATIC);
  }, 30_000);

  it.each(SOCIAL)(
    'a cleared %s is not linked; the rest stay',
    async (key) => {
      const seen = await footerOf({ ...FULL, [key]: '' });
      expect(seen.copyright).toBe(FULL.copyright);
      expect(seen.links.map(([, href]) => href)).toEqual(SOCIAL.filter((name) => name !== key).map((name) => FULL[name]));
    },
    30_000,
  );

  it('every text cleared leaves no footer line; the badge still shows', async () => {
    const seen = await footerOf({ copyright: '', github: '', x: '', linkedin: '' });
    expect(seen).toStrictEqual({ copyright: null, links: [], badge: true });
  }, 30_000);

  it('the badge follows its own switch, whatever the text', async () => {
    expect(await footerOf({ ...FULL, madeWithBadge: false })).toMatchObject({ copyright: FULL.copyright, badge: false });
    await act(async () => root?.unmount());
    root = undefined;
    expect(await footerOf({ copyright: '', github: '', x: '', linkedin: '', madeWithBadge: false })).toStrictEqual({
      copyright: null,
      links: [],
      badge: false,
    });
  }, 30_000);

  it("a language's copyright replaces the project's; cleared (footer: null) it falls back to the project's", async () => {
    languageConfig = { footer: { copyright: '© أكمي' }, seo: { metaTitle: 'توثيق' } };
    expect((await footerOf(FULL, 'ar')).copyright).toBe('© أكمي');
    await act(async () => root?.unmount());
    root = undefined;
    // What the server keeps after `{ config: { footer: null } }`: the other sections, no footer.
    languageConfig = { seo: { metaTitle: 'توثيق' } };
    const seen = await footerOf(FULL, 'ar');
    expect(seen.copyright).toBe(FULL.copyright);
    expect(seen.links).toHaveLength(3);
  }, 30_000);
});
