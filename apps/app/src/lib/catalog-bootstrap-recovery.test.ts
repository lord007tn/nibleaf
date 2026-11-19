// @vitest-environment jsdom
import { common_refresh } from '@nibleaf/i18n/messages/common_refresh';
import { translateStandalone } from '@nibleaf/i18n/standalone';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The locale bootstrap is a chunk too, and it is what used to hold the recovery
// notice, so its own failed request has to be survived without it.
const net = vi.hoisted(() => ({ claim: vi.fn(() => false), reload: vi.fn(), hydrate: vi.fn(async () => undefined) }));
vi.mock('@/lib/document-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/document-recovery')>()),
  claimDocumentRecovery: net.claim,
  reloadDocument: net.reload,
}));
vi.mock('@/routeTree.gen', async () => {
  const { createRootRoute, createRoute } = await import('@tanstack/react-router');
  const root = createRootRoute();
  return { routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/app', staticData: { dashboardLocale: true } })]) };
});

import { reloadOnceOnChunkLoadFailure } from '@/lib/chunk-reload';
import { getRouter } from '@/router';

const notice = () => document.querySelector<HTMLElement>('[role="alert"]');
const actionButton = () => document.querySelector<HTMLButtonElement>('[role="alert"] button');

beforeEach(() => {
  document.documentElement.setAttribute('data-locale', 'ar');
  document.body.innerHTML = '<main>نص من الخادم</main>';
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
});
afterEach(() => {
  vi.doUnmock('@/lib/dashboard-locale');
  document.querySelector('[role="alert"]')?.remove();
  net.claim.mockClear();
  net.reload.mockClear();
  net.hydrate.mockClear();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-locale');
  window.history.replaceState(null, '', '/');
});

const BOOTSTRAP_FAILURE = 'Failed to fetch dynamically imported module: http://localhost:3000/assets/dashboard-locale-OLD.js';

function startHydration() {
  reloadOnceOnChunkLoadFailure();
  vi.doMock('@/lib/dashboard-locale', () => {
    throw new TypeError(BOOTSTRAP_FAILURE);
  });
  window.history.replaceState(null, '', '/app');
  const state = { hydrated: false, rejected: undefined as unknown };
  Promise.resolve(getRouter().options.hydrate?.({ refreshLabel: common_refresh({}, { locale: 'ar' }) } as never)).then(
    () => {
      state.hydrated = true;
    },
    (error: unknown) => {
      state.rejected = error;
    },
  );
  return state;
}
const noticeShown = () => vi.waitFor(() => expect(notice()?.textContent).toContain(translateStandalone('error.unexpected', 'ar')), { timeout: 4000 });

it('keeps the server page, then hydrates when the bootstrap can load again', async () => {
  const state = startHydration();
  await noticeShown();
  expect(state).toEqual({ hydrated: false, rejected: undefined });
  expect(document.querySelector('main')?.textContent).toBe('نص من الخادم');
  expect(net.claim).not.toHaveBeenCalled();

  // Offline there is nothing to do but wait: the page retries by itself.
  expect(actionButton()?.hidden).toBe(true);

  vi.doUnmock('@/lib/dashboard-locale');
  vi.doMock('@/lib/dashboard-locale', () => ({ hydrateDashboardLocale: net.hydrate }));
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => expect(state.hydrated).toBe(true));
  expect(net.hydrate).toHaveBeenCalledOnce();
  expect(notice()).toBeNull();
});

it('offers a reload while online, when the bootstrap may belong to a replaced build', async () => {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  startHydration();
  await noticeShown();
  expect(net.reload).not.toHaveBeenCalled();
  expect(actionButton()?.hidden).toBe(false);
  expect(actionButton()?.textContent).toBe(common_refresh({}, { locale: 'ar' }));
  actionButton()?.click();
  expect(net.reload).toHaveBeenCalledOnce();
});

it('reveals Refresh when the connection returns but the bootstrap still fails', async () => {
  const online = vi.spyOn(window.navigator, 'onLine', 'get');
  startHydration();
  await noticeShown();
  expect(actionButton()?.hidden).toBe(true);
  online.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => expect(actionButton()?.hidden).toBe(false));
});

it('hides Refresh as soon as the connection drops, and never reloads an offline tab', async () => {
  const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  startHydration();
  await noticeShown();
  expect(actionButton()?.hidden).toBe(false);
  online.mockReturnValue(false);
  window.dispatchEvent(new Event('offline'));
  expect(actionButton()?.hidden).toBe(true);
  actionButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(net.reload).not.toHaveBeenCalled();
});

it('keeps at most one online listener while it waits between retries', async () => {
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');
  startHydration();
  await noticeShown();
  const count = (spy: typeof added | typeof removed) => spy.mock.calls.filter(([type]) => type === 'online').length;
  expect(count(added) - count(removed)).toBeLessThanOrEqual(1);
});
