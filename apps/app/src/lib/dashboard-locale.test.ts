// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({
  prepare: vi.fn().mockResolvedValue(true),
  active: undefined as (() => boolean) | undefined,
  wrapper: undefined as unknown,
  configure: vi.fn((wrapper: unknown, active: () => boolean) => {
    catalog.wrapper = wrapper;
    catalog.active = active;
  }),
}));
vi.mock('@nibleaf/i18n/dashboard-catalog', () => ({
  prepareDashboardLocale: catalog.prepare,
  configureDashboardLocaleLoading: catalog.configure,
  dashboardLocaleFailure: () => undefined,
}));
vi.mock('@nibleaf/i18n/locale-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/i18n/locale-state')>()),
  getLocale: () => 'de',
  renderedLocale: () => 'ar',
}));

import type { AnyRouter } from '@tanstack/react-router';
import { hydrateDashboardLocale, loadDashboardLocale } from './dashboard-locale';
import { trackDashboardLocaleRouter } from './dashboard-locale-boot';
import { isDashboardLocaleRouteId } from './dashboard-locale-routes';
import { runOptionalLoad } from './document-recovery';

beforeEach(() => catalog.prepare.mockClear());

it("loads the current choice for navigation rather than the document's old server snapshot", async () => {
  await loadDashboardLocale();
  expect(catalog.prepare).toHaveBeenCalledExactlyOnceWith('de');
});

it('loads the server snapshot before hydration', async () => {
  await hydrateDashboardLocale();
  expect(catalog.prepare).toHaveBeenCalledExactlyOnceWith('ar');
});

it('never lets a catalog download reload the document', () => {
  expect(catalog.wrapper).toBe(runOptionalLoad);
});

it('limits dashboard loading to the product routes that translate through its catalog', () => {
  for (const id of [
    '/app',
    '/app/o/$orgSlug/websites',
    '/git-preview/$token',
    '/welcome/name',
    '/oauth/consent',
    '/oauth/project',
    '/accept-invite/$invitationId',
    '/join/$token',
  ])
    expect(isDashboardLocaleRouteId(id)).toBe(true);
  for (const id of ['/(auth)/sign-in', '/(auth)/sign-up', '/', '/ar/$page', '/blog/$slug', '/sites/$projectId/$', '/application', '/$page'])
    expect(isDashboardLocaleRouteId(id)).toBe(false);
});

it('follows the route the router matched for the current location', () => {
  const routerAt = (id: string) =>
    ({
      latestLocation: { pathname: '/any' },
      getMatchedRoutes: () => [[{ options: {} }, { options: { staticData: { dashboardLocale: id === '/app' } } }]],
    }) as unknown as AnyRouter;
  const active = catalog.active as () => boolean;
  trackDashboardLocaleRouter(routerAt('/app'));
  expect(active()).toBe(true);
  trackDashboardLocaleRouter(routerAt('/(auth)/sign-in'));
  expect(active()).toBe(false);
});
