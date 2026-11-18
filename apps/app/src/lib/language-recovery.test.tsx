// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recovery = vi.hoisted(() => ({
  failure: undefined as ((locale: string) => void) | undefined,
  reload: vi.fn(),
  remember: vi.fn(),
}));
vi.mock('@nibleaf/i18n/dashboard-catalog', () => ({
  configureDashboardLocaleLoading: vi.fn(),
  dashboardLocaleFailure: () => new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/de-OLD.js'),
  prepareDashboardLocale: vi.fn(),
}));
vi.mock('@nibleaf/i18n/locale-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/i18n/locale-state')>()),
  rememberInterfaceLocale: recovery.remember,
  subscribeLanguageFailure: (listener: (locale: string) => void) => {
    recovery.failure = listener;
    return () => undefined;
  },
}));
vi.mock('@/lib/document-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/document-recovery')>()),
  reloadDocument: recovery.reload,
}));
// The toast library comes from the same replaced build as the catalog.
vi.mock('sonner', () => {
  throw new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/sonner-OLD.js');
});

import { ErrorPage } from '@/components/error-page';
import './dashboard-locale';

beforeEach(() => {
  recovery.reload.mockClear();
  recovery.remember.mockClear();
  document.body.replaceChildren();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('recovering from a replaced build', () => {
  it('keeps the reload reachable when the toast cannot load either', async () => {
    recovery.failure?.('de');
    const notice = await vi.waitFor(() => {
      const element = document.querySelector<HTMLElement>('[role="alert"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    (notice.querySelector('button') as HTMLButtonElement).click();
    expect(recovery.remember).toHaveBeenCalledExactlyOnceWith('de');
    expect(recovery.reload).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    [true, 1],
    [false, 0],
  ])('makes Try again on the error page reload only for a replaced build (%s)', async (reloadRequired, reloads) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const error = Object.assign(new Error('fixture'), { reloadRequired });
    const rootRoute = createRootRoute({ component: () => <ErrorPage error={error} reset={vi.fn()} /> });
    const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory(), context: { queryClient: new QueryClient() } });
    await router.load();
    const container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    await act(async () => root.render(<RouterProvider router={router} />));
    await act(async () => (container.querySelector('button') as HTMLButtonElement).click());
    expect(recovery.reload).toHaveBeenCalledTimes(reloads);
    await act(async () => root.unmount());
  });
});
