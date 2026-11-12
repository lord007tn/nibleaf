// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import type { SiteShell } from '@/hooks/api/types';

const mocks = vi.hoisted(() => ({ getSite: vi.fn(), getSitePage: vi.fn(), listChangelog: vi.fn() }));
vi.mock('@/functions/site', () => ({ getSiteFn: mocks.getSite, getSitePageFn: mocks.getSitePage, listSiteChangelogFn: mocks.listChangelog }));
vi.mock('@/lib/site-redirects', () => ({ redirectIfConfigured: async () => undefined }));
vi.mock('@/lib/site-origin', () => ({ customDomainOrigin: () => null }));
vi.mock('@/providers/site-analytics-provider', () => ({ SiteAnalyticsProvider: ({ children }: { children: unknown }) => children }));
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
import { Route as ChangelogRoute } from './changelog';
import { Route as SiteRoute } from './route';

const shell: SiteShell = {
  project: { id: 'docs', name: 'Acme Docs', slug: 'docs', description: null, config: null, primaryDomain: null },
  nav: [],
  languages: [
    { code: 'en', label: 'English', direction: 'LTR', isDefault: true },
    { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false },
  ],
  versions: [
    { id: 'v-main', name: 'main', slug: 'main', isDefault: true },
    { id: 'v-next', name: 'next', slug: 'next', isDefault: false },
  ],
  activeLanguage: 'ar',
  activeVersion: 'next',
  languageConfig: null,
  version: 1,
  generatedAt: '2026-11-01T00:00:00.000Z',
};

const rootRoute = createRootRoute({ component: () => <Outlet /> });
const siteRoute = SiteRoute.update({ id: '/sites/$projectId', path: '/sites/$projectId', getParentRoute: () => rootRoute } as never);
const splatRoute = SplatRoute.update({ id: '/$', path: '/$', getParentRoute: () => siteRoute } as never);
const changelogRoute = ChangelogRoute.update({ id: '/changelog', path: '/changelog', getParentRoute: () => siteRoute } as never);
const routeTree = rootRoute.addChildren([siteRoute.addChildren([changelogRoute, splatRoute])]);
let root: Root | undefined;

beforeEach(() => {
  // Each test re-arms React's act environment: afterEach unstubs every global.
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
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  mocks.getSite.mockResolvedValue(shell);
  mocks.getSitePage.mockRejectedValue(new ApiResponseError('Page not found', 404, 'NOT_FOUND'));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function renderReader(url: string, ready: string) {
  window.history.replaceState(null, '', url);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
    defaultPendingMs: 0,
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<RouterProvider router={router} />));
  await vi.waitFor(() => expect(container.querySelector(ready)).not.toBeNull());
  return Object.assign(container, { router });
}

describe('reader language and access', () => {
  it('switches language on a page with no known translation without leaving it or its version', async () => {
    const container = await renderReader('/sites/docs/next/moved-page?lang=ar', '[data-site-not-found]');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-switch-language="en"]')?.click());
    await vi.waitFor(() => expect(container.router.state.location.href).toBe('/sites/docs/next/moved-page'));
  });

  it('reads the changelog in the site’s default Arabic, with UTC dates and Arabic counts', async () => {
    // CI runs in UTC; a Riyadh clock (UTC+3) is where a local-time month moves on.
    vi.stubEnv('TZ', 'Asia/Riyadh');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    // The stub only works where the worker's clock follows process.env.TZ
    // (Vitest's forks pool); fail loudly rather than pass in UTC.
    expect(new Date('2026-09-03T22:30:00.000Z').getDate()).toBe(4);
    mocks.getSite.mockResolvedValue({
      ...shell,
      languages: [
        { ...shell.languages[1], isDefault: true },
        { ...shell.languages[0], isDefault: false },
      ],
      activeVersion: 'main',
    });
    mocks.listChangelog.mockResolvedValue([
      // 22:30 UTC on 30 September is already October in Riyadh; the reader still files it under September.
      { version: 3, title: 'Release 3', date: '2026-09-30T22:30:00.000Z', pages: 2 },
      { version: 2, title: 'Release 2', date: '2026-08-01T00:00:00.000Z', pages: 11 },
    ]);
    const container = await renderReader('/sites/docs/changelog', 'article');
    expect(container.querySelector('main h1')?.textContent).toBe('سجل التغييرات');
    const months = [...container.querySelectorAll('main section h2')].map((heading) => heading.textContent);
    expect(months).toEqual([
      new Date(Date.UTC(2026, 8, 1)).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'long', timeZone: 'UTC' }),
      expect.any(String),
    ]);
    expect(container.querySelector('#release-v3 time')?.getAttribute('dateTime')).toBe('2026-09-30T22:30:00.000Z');
    expect(container.querySelector('#release-v3')?.textContent).toContain('صفحتان');
    expect(container.querySelector('#release-v2')?.textContent).toContain('11 صفحة');
  });

  it('keeps a reader on the changelog when they switch language there', async () => {
    mocks.listChangelog.mockResolvedValue([]);
    const container = await renderReader('/sites/docs/changelog?lang=ar', 'main h1');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-switch-language="en"]')?.click());
    await vi.waitFor(() => expect(container.router.state.location.href).toBe('/sites/docs/changelog'));
  });

  it('states the current theme on the theme toggle', async () => {
    const container = await renderReader('/sites/docs/next/moved-page?lang=ar', '[data-site-not-found]');
    const toggle = container.querySelector('button[aria-label="الوضع الداكن"]');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the private site sign-in screen in its own name and the requested language', async () => {
    const gate = { projectId: 'docs', name: 'Acme', mode: 'READERS', language: { code: 'en', direction: 'LTR' }, config: null };
    mocks.getSite.mockRejectedValue(
      new ApiResponseError('site not found', 404, 'database:not_found', undefined, undefined, undefined, undefined, { reason: 'private', gate }),
    );
    const container = await renderReader('/sites/docs/guide?lang=ar', 'div');
    // The screen loads on demand: let the lazy chunk resolve and React commit it.
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('سجّل الدخول إلى Acme'));
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.textContent).not.toContain('المحرر');
    // Readers sign in on the site itself; there is no detour through the dashboard.
    expect(container.querySelector('a[href="/sign-in"]')).toBeNull();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });

  it('keeps the not-published screen for a site that is not published', async () => {
    mocks.getSite.mockRejectedValue(
      new ApiResponseError('site not found', 404, 'database:not_found', undefined, undefined, undefined, undefined, { reason: 'not_published' }),
    );
    const container = await renderReader('/sites/docs/guide', 'h1');
    expect(container.querySelector('h1')?.textContent).toBe('Not published yet');
    expect(container.querySelector('a[href="/sign-in"]')).toBeNull();
  });

  it('says there is no site at an address the API does not know (or a taken-down site), not that it is unpublished', async () => {
    for (const details of [undefined, { reason: 'takedown' }]) {
      mocks.getSite.mockRejectedValue(
        new ApiResponseError('site not found', 404, 'database:not_found', undefined, undefined, undefined, undefined, details),
      );
      const container = await renderReader('/sites/joodpms', 'h1');
      expect(container.querySelector('h1')?.textContent).toBe('No site at this address');
      expect(container.textContent).not.toContain('editor');
    }
  });
});
