// @vitest-environment jsdom

import type { Locale, MessageKey, MessageVariables } from '@nibleaf/i18n';
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const i18n = vi.hoisted(() => ({ locale: 'en' as string }));
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useProjects: vi.fn(),
  analytics: vi.fn(),
  refetch: vi.fn(),
  search: {} as { newSite?: boolean },
}));

// Real catalogs, controlled locale: the page count must come out translated and
// in the locale's own digits (Arabic-Indic for ar), not as a raw number.
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  const useLocale = () => ({
    locale: i18n.locale as Locale,
    setLocale: vi.fn(),
    t: (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, i18n.locale as Locale),
  });
  return { useLocale, useT: () => useLocale().t };
});
// The formatters read the same locale as the translator, as in the app.
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => i18n.locale, subscribeLanguage: () => () => undefined }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => mocks.search }),
  useNavigate: () => mocks.navigate,
  // The router's Link renders an anchor with the resolved href.
  Link: ({ to, params, children, ...props }: { to: string; params: Record<string, string>; children: ReactNode }) => (
    <a href={to.replace('$projectId', params.projectId ?? '')} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/api/query-options', () => ({ projectsQueryOptions: () => ({ queryKey: ['projects'] }) }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/hooks/api', () => ({ useProjects: mocks.useProjects, useWorkspaceAnalytics: mocks.analytics }));
vi.mock('@/components/app/new-project-dialog', () => ({
  NewProjectDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="new-site-dialog" /> : null),
}));

import { Route } from './sites';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SitesPage = Route.options.component as unknown as ComponentType;

describe('SitesPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    await act(async () => root.render(<SitesPage />));
  };

  beforeEach(() => {
    i18n.locale = 'en';
    mocks.search = {};
    mocks.analytics.mockReturnValue({ isSuccess: true, data: { availability: 'complete', byProject: [{ projectId: 'project-1', views: 1218 }] } });
    mocks.useProjects.mockReturnValue({
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: mocks.refetch,
      data: [{ id: 'project-1', name: 'Docs', slug: 'docs', _count: { pages: 58, deployments: 3 } }],
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows the site page count through the translated count message', async () => {
    await render();

    expect(container.textContent).toContain('58 pages');
  });

  it('says one page, and two pages in Arabic, from the number itself', async () => {
    mocks.useProjects.mockReturnValue({ ...mocks.useProjects(), data: [{ id: 'project-1', name: 'Docs', slug: 'docs', _count: { pages: 1 } }] });
    await render();
    expect(container.textContent).toContain('1 page');
    expect(container.textContent).not.toContain('1 pages');

    i18n.locale = 'ar';
    mocks.useProjects.mockReturnValue({ ...mocks.useProjects(), data: [{ id: 'project-1', name: 'Docs', slug: 'docs', _count: { pages: 2 } }] });
    await render();
    expect(container.textContent).toContain('صفحتان');
  });

  it('renders each site card as a link to its overview, named by the site', async () => {
    await render();
    const card = container.querySelector<HTMLAnchorElement>('a[href="/app/projects/project-1"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Docs');
    expect(container.querySelector('button[type="button"] bdi')).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('hydrates the loading boundary before rendering an already-cached project query', async () => {
    const readyQuery = mocks.useProjects();
    await act(async () => root.unmount());
    mocks.useProjects.mockReturnValue({ isPending: true, isError: false, isFetching: true, data: undefined, refetch: mocks.refetch });
    container.innerHTML = renderToString(<SitesPage />);
    mocks.useProjects.mockReturnValue(readyQuery);
    const recoverableErrors = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, <SitesPage />, { onRecoverableError: recoverableErrors });
    });
    expect(recoverableErrors).not.toHaveBeenCalled();
    expect(container.textContent).toContain('58 pages');
  });

  it('gives the site filter an explicit accessible name', async () => {
    await render();

    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search?.getAttribute('aria-label')).toBe('Search…');
  });

  it('formats the page count in Western digits for the Arabic interface', async () => {
    i18n.locale = 'ar';
    await render();

    expect(container.textContent).toContain('58 صفحة');
    expect(container.textContent).not.toMatch(/[٠-٩]/);
  });

  it('shows a recoverable error instead of a first-site prompt when loading fails', async () => {
    mocks.useProjects.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch: mocks.refetch });
    await render();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(container.textContent).not.toContain('Create your first');
    await act(async () => alert?.querySelector<HTMLButtonElement>('button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('distinguishes an unmatched search and lets the user restore existing sites', async () => {
    await render();
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(search, 'nothing-matches');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container.textContent).toContain('No sites match your search.');
    const clear = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear search');
    expect(clear).toBeDefined();
    await act(async () => clear?.click());
    expect(container.textContent).toContain('58 pages');
    expect(search?.value).toBe('');
  });
  const sites = [
    {
      id: 'live',
      name: 'Acme',
      slug: 'acme',
      live: true,
      lastPublishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      _count: { pages: 18 },
    },
    { id: 'draft', name: 'Handbook', slug: 'handbook', live: false, lastPublishedAt: null, _count: { pages: 10 } },
    { id: 'busy', name: 'Help', slug: 'help', live: true, publishing: true, lastPublishedAt: null, _count: { pages: 13 } },
  ];
  const cardText = (id: string) => container.querySelector(`a[href="/app/projects/${id}"]`)?.textContent ?? '';

  it('says what readers can see on each site: live, not published or publishing, and when it went live', async () => {
    mocks.useProjects.mockReturnValue({ ...mocks.useProjects(), data: sites });
    mocks.analytics.mockReturnValue({ isSuccess: true, data: { availability: 'complete', byProject: [] } });
    await render();
    expect(container.querySelector('a[href="/app/projects/live"] [data-status]')?.getAttribute('data-status')).toBe('live');
    expect(cardText('live')).toContain('Published 3d ago');
    expect(container.querySelector('a[href="/app/projects/draft"] [data-status]')?.getAttribute('data-status')).toBe('notPublished');
    expect(cardText('draft')).not.toContain('Published');
    expect(container.querySelector('a[href="/app/projects/busy"] [data-status]')?.getAttribute('data-status')).toBe('publishing');
  });

  it('adds 30-day views when analytics answered, and leaves them out (not zero) when it did not', async () => {
    await render();
    expect(cardText('project-1')).toContain('1,218');
    mocks.analytics.mockReturnValue({ isSuccess: false, isError: true, data: undefined });
    await render();
    expect(cardText('project-1')).not.toContain('Views');
    expect(cardText('project-1')).not.toContain(': 0');
  });

  it('keeps polling while a site is publishing, so the badge does not stay on "Publishing…"', async () => {
    await render();
    expect(mocks.useProjects).toHaveBeenCalledWith({ pollWhilePublishing: true });
  });

  it('marks the publish date up as a machine-readable time', async () => {
    mocks.useProjects.mockReturnValue({ ...mocks.useProjects(), data: sites });
    await render();
    const time = container.querySelector('a[href="/app/projects/live"] time');
    expect(time?.getAttribute('datetime')).toBe(sites[0]?.lastPublishedAt);
  });

  it('opens New site from the URL, so the palette and switcher can open it again on this page', async () => {
    await render();
    expect(container.querySelector('[data-testid="new-site-dialog"]')).toBeNull();
    const create = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('New site'));
    await act(async () => create?.click());
    const call = mocks.navigate.mock.calls.at(-1)?.[0] as { search: (prev: object) => object; replace: boolean };
    expect(call.search({})).toEqual({ newSite: true });
    expect(call.replace).toBe(false);

    mocks.search = { newSite: true };
    await render();
    expect(container.querySelector('[data-testid="new-site-dialog"]')).not.toBeNull();
  });
});
