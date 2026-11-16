// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SitePage, SiteShell } from '@/hooks/api/types';

const mocks = vi.hoisted(() => ({ getSite: vi.fn(), getSitePage: vi.fn(), listChangelog: vi.fn(), search: vi.fn() }));
vi.mock('@/functions/site', () => ({ getSiteFn: mocks.getSite, getSitePageFn: mocks.getSitePage, listSiteChangelogFn: mocks.listChangelog }));
vi.mock('@/hooks/api/site-search', () => ({ useSiteSearch: mocks.search }));
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
 * The published header's search trigger lists '/' in its `aria-keyshortcuts`,
 * and shows it as its key hint on a '/' site, only while the reader has the
 * shortcut on (WCAG 2.1.4, site-search-shortcut.ts). This renders the real
 * site route, so the header reads the same preference the search footer's
 * switch writes, and the one another tab of the site changes.
 */
const PATH = 'start';
const KEY = 'nibleaf:site-search:slash-shortcut:docs';
let searchConfig: Record<string, unknown> | undefined;

const shell = (): SiteShell =>
  ({
    project: { id: 'docs', name: 'Acme', slug: 'docs', description: null, config: { search: searchConfig }, primaryDomain: null },
    nav: [{ id: 'p', kind: 'PAGE', title: 'Start', path: PATH, icon: null, tag: null, children: [] }],
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true }],
    versions: [{ id: 'v', name: 'main', slug: 'main', isDefault: true }],
    activeLanguage: 'en',
    activeVersion: 'main',
    languageConfig: null,
    version: 1,
    generatedAt: '2026-11-01T00:00:00.000Z',
  }) as SiteShell;

const page = (): SitePage =>
  ({
    project: shell().project,
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
    activeLanguage: 'en',
    activeVersion: 'main',
    versions: shell().versions,
    languageConfig: null,
    languages: [{ code: 'en', isDefault: true, path: PATH }],
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
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  localStorage.clear();
  searchConfig = undefined;
  mocks.getSite.mockImplementation(async () => shell());
  mocks.getSitePage.mockImplementation(async () => page());
  mocks.search.mockReturnValue({ data: [], isFetching: false, error: null, refetch: vi.fn() });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function openPage() {
  const url = `/sites/docs/${PATH}`;
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
}

const trigger = () => {
  const button = document.querySelector<HTMLButtonElement>('header [data-theme-region="search-trigger"]');
  if (!button) throw new Error('Missing the header search trigger');
  return button;
};
const shortcuts = () => trigger().getAttribute('aria-keyshortcuts');
const keyHint = () => trigger().querySelector('kbd')?.textContent;

/** Flips the '/' switch in search's footer, opened from the header trigger, and closes search. */
async function flipFromFooter() {
  await act(async () => trigger().click());
  const control = await vi.waitFor(
    () => {
      const found = document.querySelector<HTMLElement>('[role="dialog"] [role="switch"]');
      if (!found) throw new Error('Search has not opened');
      return found;
    },
    { timeout: 15_000 },
  );
  await act(async () => control.click());
  await act(async () => {
    document.querySelector<HTMLElement>('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
}

describe("the header's search trigger and the '/' preference", () => {
  it.each([
    [undefined, 'Control+K Meta+K /'],
    ['slash', '/ Control+K Meta+K'],
  ] as const)(
    "lists / in the trigger's aria-keyshortcuts only while it is on (shown shortcut %s)",
    async (hotkey, on) => {
      searchConfig = hotkey ? { hotkey } : undefined;
      await openPage();
      expect(shortcuts()).toBe(on);
      if (hotkey === 'slash') expect(keyHint()).toBe('/');

      await flipFromFooter();
      expect(localStorage.getItem(KEY)).toBe('off');
      expect(shortcuts()).toBe('Control+K Meta+K');
      // A '/' site's hint falls back to the ⌘K / Ctrl K label.
      expect(keyHint()).not.toBe('/');

      await flipFromFooter();
      expect(shortcuts()).toBe(on);
      if (hotkey === 'slash') expect(keyHint()).toBe('/');
    },
    30_000,
  );

  it("follows another tab's change", async () => {
    searchConfig = { hotkey: 'slash' };
    await openPage();
    await act(async () => {
      localStorage.setItem(KEY, 'off');
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'off', storageArea: localStorage }));
    });
    expect(shortcuts()).toBe('Control+K Meta+K');
    expect(keyHint()).not.toBe('/');
  }, 30_000);
});
