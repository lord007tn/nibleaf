// @vitest-environment jsdom
import { common_refresh } from '@nibleaf/i18n/messages/common_refresh';
import { translateStandalone } from '@nibleaf/i18n/standalone';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recovery = vi.hoisted(() => ({ reload: vi.fn() }));
vi.mock('@/lib/document-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/document-recovery')>()),
  reloadDocument: recovery.reload,
}));

import { ErrorPage } from '@/components/error-page';

beforeEach(() => {
  recovery.reload.mockClear();
  document.body.replaceChildren();
});
afterEach(() => vi.unstubAllGlobals());

describe('recovering from a replaced build', () => {
  it.each([
    [common_refresh({}, { locale: 'en' }), 1, common_refresh({}, { locale: 'en' })],
    [undefined, 0, translateStandalone('error.tryAgain', 'en')],
  ])('labels the error page action for what it does (%s)', async (reloadLabel, reloads, label) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const error = Object.assign(new Error('fixture'), { reloadLabel });
    const rootRoute = createRootRoute({ component: () => <ErrorPage error={error} reset={vi.fn()} /> });
    const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory(), context: { queryClient: new QueryClient() } });
    await router.load();
    const container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    await act(async () => root.render(<RouterProvider router={router} />));
    const action = container.querySelector('button') as HTMLButtonElement;
    expect(action.textContent).toBe(label);
    await act(async () => action.click());
    expect(recovery.reload).toHaveBeenCalledTimes(reloads);
    await act(async () => root.unmount());
  });
});
