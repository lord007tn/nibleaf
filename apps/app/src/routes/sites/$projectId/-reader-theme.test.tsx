// @vitest-environment jsdom
import { ThemeProvider } from '@nibleaf/design-system/theme';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SitePage, SiteShell } from '@/hooks/api/types';
import { useRootDocument } from '@/lib/root-document';

const mocks = vi.hoisted(() => ({ getSite: vi.fn(), getSitePage: vi.fn(), listChangelog: vi.fn() }));
vi.mock('@/functions/site', () => ({ getSiteFn: mocks.getSite, getSitePageFn: mocks.getSitePage, listSiteChangelogFn: mocks.listChangelog }));
vi.mock('@/lib/site-redirects', () => ({ redirectIfConfigured: async () => undefined }));
vi.mock('@/lib/site-origin', () => ({ customDomainOrigin: () => null }));
vi.mock('@/providers/site-analytics-provider', () => ({
  SiteAnalyticsProvider: ({ children }: { children: unknown }) => children,
  useSiteAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@/components/site/site-analytics-consent', () => ({ SiteAnalyticsConsent: () => null }));
// Plain buttons stand in for the dropdown, so a test can pick a language.
vi.mock('@/components/site/language-switcher', () => ({
  LanguageSwitcher: ({ languages, onChange }: { languages: Array<{ code: string }>; onChange: (code: string) => void }) =>
    languages.map((language) => (
      <button key={language.code} type="button" data-switch-language={language.code} onClick={() => onChange(language.code)}>
        {language.code}
      </button>
    )),
}));

import { Route as SplatRoute } from './$';
import { Route as SiteRoute } from './route';

const PATH = 'blog/add-new-reservation-2';

// The audited site: English by default, and this post has no Arabic
// translation. Each test sets the configured theme it needs.
/** The site's configured theme (`styling.theme`). */
let siteConfig: SiteShell['project']['config'] = null;
const LIGHT_SITE = { styling: { theme: 'light' } } as SiteShell['project']['config'];

const shell = (activeLanguage: string): SiteShell => ({
  project: { id: 'docs', name: 'Jood Booking', slug: 'docs', description: null, config: siteConfig, primaryDomain: null },
  nav: [{ id: 'p', kind: 'PAGE', title: 'Add a new reservation', path: PATH, icon: null, tag: null, children: [] }],
  languages: [
    { code: 'en', label: 'English', direction: 'LTR', isDefault: true },
    { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false },
  ],
  versions: [{ id: 'v', name: 'main', slug: 'main', isDefault: true }],
  activeLanguage,
  activeVersion: 'main',
  languageConfig: null,
  version: 1,
  generatedAt: '2026-11-01T00:00:00.000Z',
});

const englishPage: SitePage = {
  project: shell('en').project,
  page: {
    id: 'page-1',
    createdAt: '2026-10-17T00:00:00.000Z',
    updatedAt: '2026-10-17T00:00:00.000Z',
    title: 'Add a new reservation',
    description: null,
    excerpt: '',
    icon: null,
    path: PATH,
    content: 'Open the front desk calendar.',
    headings: [],
    config: null,
  },
  activeLanguage: 'en',
  activeVersion: 'main',
  versions: shell('en').versions,
  languageConfig: null,
  languages: [
    { code: 'en', isDefault: true, path: PATH },
    { code: 'ar', isDefault: false, path: null },
  ],
  breadcrumbs: [{ title: 'Add a new reservation', path: PATH }],
  prev: null,
  next: null,
};

/** The root document as the app wires it (routes/__root.tsx): the dashboard
 *  theme provider owns `<html>` unless a published site does. */
function RootDocumentStandIn() {
  const { lang, dir, siteProjectId } = useRootDocument();
  return (
    <ThemeProvider applyDocumentTheme={!siteProjectId}>
      <div data-root-document data-lang={lang} data-dir={dir} data-site={siteProjectId ?? ''}>
        <Outlet />
      </div>
    </ThemeProvider>
  );
}

const rootRoute = createRootRoute({ component: RootDocumentStandIn });
const siteRoute = SiteRoute.update({ id: '/sites/$projectId', path: '/sites/$projectId', getParentRoute: () => rootRoute } as never);
const splatRoute = SplatRoute.update({ id: '/$', path: '/$', getParentRoute: () => siteRoute } as never);
const routeTree = rootRoute.addChildren([siteRoute.addChildren([splatRoute])]);
let root: Root | undefined;

const documentTheme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

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
  // The reader's OS prefers dark, and nothing is stored: a site configured
  // light stays light; one that never chose follows the OS.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: query.includes('dark'), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  localStorage.clear();
  siteConfig = LIGHT_SITE;
  document.documentElement.className = '';
  mocks.getSite.mockImplementation(async ({ data }: { data: { language?: string } }) => shell(data.language ?? 'en'));
  mocks.getSitePage.mockResolvedValue(englishPage);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function renderReader(url: string) {
  window.history.replaceState(null, '', url);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
    // Like production: a slow load shows the pending UI, here at once.
    defaultPendingMs: 0,
    defaultPendingComponent: () => <div data-pending />,
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<RouterProvider router={router} />));
  await vi.waitFor(() => expect(container.querySelector('article h1')).not.toBeNull(), { timeout: 15_000 });
  return container;
}

describe('reader theme across languages', () => {
  it('keeps the configured light theme on an English page and on its Arabic fallback opened directly', async () => {
    await renderReader(`/sites/docs/${PATH}`);
    expect(documentTheme()).toBe('light');
    await act(async () => root?.unmount());
    root = undefined;
    document.documentElement.className = '';

    const container = await renderReader(`/sites/docs/${PATH}?lang=ar`);
    expect(container.querySelector('[role="note"]')?.getAttribute('lang')).toBe('ar');
    expect(documentTheme()).toBe('light');
  }, 30_000);

  it('keeps the light theme and the site’s document while switching to the Arabic fallback', async () => {
    const container = await renderReader(`/sites/docs/${PATH}`);
    expect(documentTheme()).toBe('light');

    // Hold the Arabic shell back so the router shows the pending reader route.
    let releaseShell: () => void = () => undefined;
    mocks.getSite.mockImplementation(
      ({ data }: { data: { language?: string } }) =>
        new Promise<SiteShell>((resolve) => {
          releaseShell = () => resolve(shell(data.language ?? 'en'));
        }),
    );
    await act(async () => container.querySelector<HTMLButtonElement>('[data-switch-language="ar"]')?.click());
    await vi.waitFor(() => expect(container.querySelector('[data-pending]')).not.toBeNull());
    expect(documentTheme()).toBe('light');
    const rootDocument = container.querySelector('[data-root-document]');
    // Still the same site, already in the requested Arabic, while its shell
    // reloads: the dashboard (English, left to right, OS theme) never takes over.
    expect(rootDocument?.getAttribute('data-site')).toBe('docs');
    expect(rootDocument?.getAttribute('data-lang')).toBe('ar');
    expect(rootDocument?.getAttribute('data-dir')).toBe('rtl');

    await act(async () => releaseShell());
    await vi.waitFor(() => expect(container.querySelector('[role="note"]')).not.toBeNull(), { timeout: 15_000 });
    expect(rootDocument?.getAttribute('data-lang')).toBe('ar');
    expect(rootDocument?.getAttribute('data-dir')).toBe('rtl');
    expect(documentTheme()).toBe('light');
  }, 30_000);
});

/** The OS colour preference, changeable while a test runs. */
function stubOsTheme(initial: 'light' | 'dark') {
  let dark = initial === 'dark';
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query.includes('dark') ? dark : !dark;
      },
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    })),
  );
  return (next: 'light' | 'dark') =>
    act(async () => {
      dark = next === 'dark';
      for (const listener of listeners) listener({ matches: dark } as MediaQueryListEvent);
    });
}

/** Switches to Arabic with the Arabic shell held back; returns its release. */
async function switchToArabicHeld(container: HTMLElement) {
  let releaseShell: () => void = () => undefined;
  mocks.getSite.mockImplementation(
    ({ data }: { data: { language?: string } }) =>
      new Promise<SiteShell>((resolve) => {
        releaseShell = () => resolve(shell(data.language ?? 'en'));
      }),
  );
  await act(async () => container.querySelector<HTMLButtonElement>('[data-switch-language="ar"]')?.click());
  await vi.waitFor(() => expect(container.querySelector('[data-pending]')).not.toBeNull());
  return async () => {
    await act(async () => releaseShell());
    await vi.waitFor(() => expect(container.querySelector('[role="note"]')).not.toBeNull(), { timeout: 15_000 });
  };
}

const themeToggle = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button[aria-pressed]');

describe('reader theme sources across a language switch', () => {
  it('follows the OS when the owner never chose a theme (PUB-004)', async () => {
    siteConfig = { styling: {} } as SiteShell['project']['config'];
    const setOs = stubOsTheme('dark');
    const container = await renderReader(`/sites/docs/${PATH}`);
    expect(documentTheme()).toBe('dark');
    const release = await switchToArabicHeld(container);
    expect(documentTheme()).toBe('dark');
    await setOs('light');
    await release();
    expect(documentTheme()).toBe('light');
  }, 30_000);

  it('follows the OS for a site with no config at all', async () => {
    siteConfig = null;
    stubOsTheme('dark');
    await renderReader(`/sites/docs/${PATH}`);
    expect(documentTheme()).toBe('dark');
  }, 30_000);

  it.each(['light', 'dark'] as const)(
    'keeps a stored %s choice over the configured theme and the OS',
    async (stored) => {
      stubOsTheme(stored === 'dark' ? 'light' : 'dark');
      localStorage.setItem('nibleaf.site.theme.docs', stored);
      const container = await renderReader(`/sites/docs/${PATH}`);
      expect(documentTheme()).toBe(stored);
      const release = await switchToArabicHeld(container);
      expect(documentTheme()).toBe(stored);
      await release();
      expect(documentTheme()).toBe(stored);
    },
    30_000,
  );

  it('follows the OS in configured system mode, including a change while the next language loads', async () => {
    siteConfig = { styling: { theme: 'system' } } as SiteShell['project']['config'];
    const setOs = stubOsTheme('dark');
    const container = await renderReader(`/sites/docs/${PATH}`);
    expect(documentTheme()).toBe('dark');
    const release = await switchToArabicHeld(container);
    expect(documentTheme()).toBe('dark');
    // The OS turns light during the pending navigation.
    await setOs('light');
    await release();
    expect(documentTheme()).toBe('light');
  }, 30_000);

  it('keeps an explicit toggle across the switch, even when the OS then changes', async () => {
    siteConfig = { styling: { theme: 'system' } } as SiteShell['project']['config'];
    const setOs = stubOsTheme('light');
    const container = await renderReader(`/sites/docs/${PATH}`);
    expect(documentTheme()).toBe('light');
    await act(async () => themeToggle(container)?.click());
    expect(documentTheme()).toBe('dark');
    expect(localStorage.getItem('nibleaf.site.theme.docs')).toBe('dark');
    const release = await switchToArabicHeld(container);
    await setOs('light');
    expect(documentTheme()).toBe('dark');
    await release();
    expect(documentTheme()).toBe('dark');
    expect(themeToggle(container)?.getAttribute('aria-pressed')).toBe('true');
  }, 30_000);
});
