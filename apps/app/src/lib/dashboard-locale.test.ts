// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({
  prepare: vi.fn().mockResolvedValue(true),
  active: undefined as (() => boolean) | undefined,
  configure: vi.fn((_wrapper: unknown, active: () => boolean) => {
    catalog.active = active;
  }),
}));
vi.mock('@nibleaf/i18n/dashboard-catalog', () => ({ prepareDashboardLocale: catalog.prepare, configureDashboardLocaleLoading: catalog.configure }));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'de', renderedLocale: () => 'ar' }));

import { hydrateDashboardLocale, loadDashboardLocale } from './dashboard-locale';
import { needsDashboardLocale } from './dashboard-locale-path';

beforeEach(() => catalog.prepare.mockClear());

it("loads the current choice for navigation rather than the document's old server snapshot", async () => {
  await loadDashboardLocale();
  expect(catalog.prepare).toHaveBeenCalledExactlyOnceWith('de');
});

it('loads the server snapshot before hydration', async () => {
  await hydrateDashboardLocale();
  expect(catalog.prepare).toHaveBeenCalledExactlyOnceWith('ar');
});

it('limits dashboard loading to its two consumer route families', () => {
  for (const path of ['/app', '/app/o/fixture/websites', '/git-preview/fixture']) expect(needsDashboardLocale(path)).toBe(true);
  for (const path of ['/sign-in', '/sign-up', '/', '/ar', '/sites/fixture', '/application']) expect(needsDashboardLocale(path)).toBe(false);
  const active = catalog.active as () => boolean;
  window.history.replaceState(null, '', '/app/o/fixture/websites');
  expect(active()).toBe(true);
  window.history.replaceState(null, '', '/sign-in');
  expect(active()).toBe(false);
});
