// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import type { SitePage, SiteShell } from '@/hooks/api/types';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';

const mocks = vi.hoisted(() => ({ getSite: vi.fn(), getSitePage: vi.fn() }));
vi.mock('@/functions/site', () => ({ getSiteFn: mocks.getSite, getSitePageFn: mocks.getSitePage }));
vi.mock('@/lib/site-redirects', () => ({ redirectIfConfigured: async () => undefined }));
vi.mock('@/lib/site-origin', () => ({ customDomainOrigin: () => null }));
vi.mock('@/providers/site-analytics-provider', () => ({ SiteAnalyticsProvider: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/site/site-analytics-consent', () => ({ SiteAnalyticsConsent: () => null }));

import { Route as SplatRoute } from '@/routes/sites/$projectId/$';
import { Route as SiteRoute } from '@/routes/sites/$projectId/route';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const shell: SiteShell = {
  project: { id: 'docs', name: 'Acme Docs', slug: 'docs', description: null, config: null, primaryDomain: null },
  nav: [{ id: 'start', kind: 'PAGE', title: 'Start', path: 'start', icon: null, tag: null, children: [] }],
  languages: [
    { code: 'en', label: 'English', direction: 'LTR', isDefault: true },
    { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false },
  ],
  versions: [
    { id: 'v-main', name: 'main', slug: 'main', isDefault: true },
    { id: 'v-next', name: 'next', slug: 'next', isDefault: false },
  ],
  activeLanguage: 'ar',
  activeVersion: 'main',
  languageConfig: null,
  version: 1,
  generatedAt: '2026-11-01T00:00:00.000Z',
};

const rootRoute = createRootRoute({ component: () => <Outlet /> });
const siteRoute = SiteRoute.update({ id: '/sites/$projectId', path: '/sites/$projectId', getParentRoute: () => rootRoute } as never);
const splatRoute = SplatRoute.update({ id: '/$', path: '/$', getParentRoute: () => siteRoute } as never);
const routeTree = rootRoute.addChildren([siteRoute.addChildren([splatRoute])]);

const MISSING = '/sites/docs/no-such-page?lang=ar';
let root: Root | undefined;

beforeEach(() => {
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

async function renderReader(url: string) {
  // Site links resolve against the real location (path-based vs custom-domain serving).
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
  await vi.waitFor(() => expect(container.querySelector('main')).not.toBeNull());
  return Object.assign(container, { router });
}

it('shows the configured emoji in the reader header when there is no uploaded logo', async () => {
  mocks.getSite.mockResolvedValueOnce({ ...shell, project: { ...shell.project, icon: '📘' } });
  await renderReader(MISSING);
  expect(document.querySelector('header')?.textContent).toContain('📘');
});

describe('published reader chrome', () => {
  it('starts with a localized skip link that moves focus to the content landmark', async () => {
    const container = await renderReader(MISSING);
    const focusable = container.querySelector<HTMLAnchorElement>('a[href], button');
    expect(focusable?.getAttribute('href')).toBe('#site-content');
    expect(focusable?.textContent).toBe('تخطَّ إلى المحتوى');

    const main = container.querySelector('main');
    expect(main?.id).toBe('site-content');
    expect(main?.tabIndex).toBe(-1);
    await act(async () => focusable?.click());
    expect(document.activeElement).toBe(main);
  });

  it('keeps the phone header to one row and labels its controls plainly', async () => {
    const container = await renderReader(MISSING);
    const header = container.querySelector('header');
    expect(header?.className).toContain('flex-nowrap');
    expect(header?.className).not.toContain('flex-wrap ');
    // The header switchers are hidden below `sm`; the drawer carries them there.
    const switchers = container.querySelector('[aria-label="اللغة: العربية"]')?.parentElement;
    expect(switchers?.className).toMatch(/(^| )hidden( |$)/);
    expect(switchers?.className).toContain('sm:flex');
    expect(container.querySelector('[aria-label="الإصدار: main"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="sheet-trigger"]')?.getAttribute('aria-label')).toBe('فتح القائمة');
    const navLabels = [...container.querySelectorAll('nav[aria-label]')].map((nav) => nav.getAttribute('aria-label'));
    expect(navLabels).toContain('صفحات الوثائق');
    expect(new Set(navLabels).size).toBe(navLabels.length);
  });

  it('renders a missing page inside the chrome, in the site language, with a way back into the docs', async () => {
    const container = await renderReader(MISSING);
    await vi.waitFor(() => expect(container.querySelector('[data-site-not-found]')).not.toBeNull());
    const notFound = container.querySelector('main [data-site-not-found]');
    expect(notFound?.querySelector('h1')?.textContent).toBe('لم نعثر على هذه الصفحة');
    // Still inside the reader: the header and sidebar stay available.
    expect(container.querySelector('header')).not.toBeNull();
    const home = notFound?.querySelector<HTMLAnchorElement>('a[href]');
    expect(home?.getAttribute('href')).toBe('/sites/docs?lang=ar');
    expect(home?.textContent).toBe('الذهاب إلى الصفحة الرئيسية للوثائق');
    expect(notFound?.querySelector('button')?.textContent).toBe('ابحث في الوثائق');
  });

  it('keeps the chrome and shows an article-shaped placeholder while the next page loads', async () => {
    const container = await renderReader(MISSING);
    await vi.waitFor(() => expect(container.querySelector('[data-site-not-found]')).not.toBeNull());
    mocks.getSitePage.mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      void container.router.navigate({ href: '/sites/docs/start?lang=ar' });
    });
    await vi.waitFor(() => expect(container.querySelector('main [data-site-article-skeleton]')).not.toBeNull());
    const placeholder = container.querySelector('main [data-site-article-skeleton]');
    expect(placeholder?.getAttribute('aria-busy')).toBe('true');
    expect(placeholder?.querySelector('[role="status"]')?.textContent).toBe('جارٍ التحميل…');
    // The header and sidebar stay; no full-screen loader replaces the docs.
    expect(container.querySelector('header')).not.toBeNull();
    expect(container.querySelector('nav[aria-label="صفحات الوثائق"]')).not.toBeNull();
  });
});

describe('published page loader', () => {
  const page = { versions: [], activeVersion: 'main', page: { path: 'start' } } as unknown as SitePage;
  const load = (queryClient: QueryClient) =>
    (
      SplatRoute.options.loader as unknown as (input: {
        params: { projectId: string; _splat: string };
        deps: { lang?: string };
        location: { searchStr: string };
        context: { queryClient: QueryClient };
      }) => Promise<{ page: SitePage }>
    )({ params: { projectId: 'docs', _splat: 'start' }, deps: { lang: 'ar' }, location: { searchStr: '' }, context: { queryClient } });

  it('reads pages through the shared query cache, so a preloaded or recent page opens without another request', async () => {
    mocks.getSitePage.mockResolvedValue(page);
    // The app's client: a page read moments ago is still fresh.
    const queryClient = createQueryClient();
    await expect(load(queryClient)).resolves.toMatchObject({ page });
    expect(queryClient.getQueryData(queryKeys.site.page('docs', 'start', 'ar', 'start'))).toBe(page);
    await load(queryClient);
    expect(mocks.getSitePage).toHaveBeenCalledOnce();
    expect(mocks.getSitePage).toHaveBeenCalledWith({ data: { projectId: 'docs', path: 'start', language: 'ar', version: 'start' } });
  });

  it('waits for the published page again once the cached copy is stale', async () => {
    const republished = { ...page, page: { path: 'start', title: 'Updated' } } as unknown as SitePage;
    mocks.getSitePage.mockResolvedValue(republished);
    const queryClient = createQueryClient();
    queryClient.setQueryData(queryKeys.site.page('docs', 'start', 'ar', 'start'), page, { updatedAt: Date.now() - 60_000 });
    // The article renders the loader's result, so a stale copy must never be returned.
    await expect(load(queryClient)).resolves.toMatchObject({ page: republished });
    expect(mocks.getSitePage).toHaveBeenCalledOnce();
  });
});
