// @vitest-environment jsdom
import { common_refresh } from '@nibleaf/i18n/messages/common_refresh';
import { translateStandalone } from '@nibleaf/i18n/standalone';
import { toast } from 'sonner';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The real router hook, stale-chunk listener and locale bootstrap. Only the
 * network is modelled: a catalog import behaves as Vite's preload helper does
 * when its request fails, dispatching `vite:preloadError` and rethrowing.
 */
const net = vi.hoisted(() => ({
  down: true,
  failure: undefined as unknown,
  wrapper: ((load: () => Promise<unknown>) => load()) as (load: () => Promise<unknown>) => Promise<unknown>,
  claim: vi.fn(() => false),
  reload: vi.fn(),
  languageFailure: undefined as ((locale: string) => void) | undefined,
  setLanguage: vi.fn(),
  remember: vi.fn(),
}));
const CATALOG_URL = 'http://localhost:3000/assets/ar-OLD.js';

function viteImport(): Promise<unknown> {
  return Promise.resolve().then(() => {
    if (!net.down) return {};
    const error = new TypeError(`Failed to fetch dynamically imported module: ${CATALOG_URL}`);
    const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: error });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw error;
  });
}

vi.mock('@nibleaf/i18n/dashboard-catalog', () => ({
  configureDashboardLocaleLoading: (wrapper: typeof net.wrapper) => {
    net.wrapper = wrapper;
  },
  dashboardLocaleFailure: () => net.failure,
  prepareDashboardLocale: (_locale: string, options?: { required?: boolean }) =>
    (options?.required ? viteImport() : net.wrapper(viteImport)).then(
      () => true,
      (error: unknown) => {
        net.failure = error;
        return false;
      },
    ),
}));
vi.mock('@nibleaf/i18n/locale-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/i18n/locale-state')>()),
  rememberInterfaceLocale: net.remember,
  setLanguage: net.setLanguage,
  subscribeLanguageFailure: (listener: (locale: string) => void) => {
    net.languageFailure = listener;
    return () => undefined;
  },
}));
vi.mock('@/lib/document-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/document-recovery')>()),
  claimDocumentRecovery: net.claim,
  reloadDocument: net.reload,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/routeTree.gen', async () => {
  const { createRootRoute, createRoute } = await import('@tanstack/react-router');
  const root = createRootRoute();
  return { routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/app' })]) };
});

import { reloadOnceOnChunkLoadFailure } from '@/lib/chunk-reload';
import { getRouter } from '@/router';

const SERVER_HTML = '<main>نص من الخادم</main>';
const notice = () => document.querySelector<HTMLElement>('[role="alert"]');
const button = () => notice()?.querySelector('button') as HTMLButtonElement;
const settle = (milliseconds = 0) => vi.advanceTimersByTimeAsync(milliseconds);
const setOnline = (online: boolean) => vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);
const serveAssets = (status: number) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status })),
  );

function startHydration() {
  window.history.replaceState(null, '', '/app');
  const state = { hydrated: false, rejected: undefined as unknown };
  Promise.resolve(getRouter().options.hydrate?.(undefined as never)).then(
    () => {
      state.hydrated = true;
    },
    (error: unknown) => {
      state.rejected = error;
    },
  );
  return state;
}

// Loaded up front: module loading needs real time, the retries below use fake time.
beforeAll(async () => {
  await import('@/lib/dashboard-locale');
  reloadOnceOnChunkLoadFailure();
});

beforeEach(() => {
  vi.useFakeTimers();
  net.down = true;
  net.failure = undefined;
  net.claim.mockClear();
  net.reload.mockClear();
  net.setLanguage.mockClear();
  net.remember.mockClear();
  vi.mocked(toast.error).mockClear();
  document.documentElement.setAttribute('data-locale', 'ar');
  document.body.innerHTML = SERVER_HTML;
  setOnline(true);
  serveAssets(200);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-locale');
  window.history.replaceState(null, '', '/');
});

describe('a catalog that fails while the document starts', () => {
  it('keeps the server page when the connection drops, then hydrates on reconnect', async () => {
    setOnline(false);
    const state = startHydration();
    await settle(5000);

    expect(net.claim).not.toHaveBeenCalled();
    expect(net.reload).not.toHaveBeenCalled();
    expect(state).toEqual({ hydrated: false, rejected: undefined });
    expect(document.querySelector('main')?.textContent).toBe('نص من الخادم');
    expect(notice()?.textContent).toContain(translateStandalone('error.unexpected', 'ar'));

    net.down = false;
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(state.hydrated).toBe(true);
    expect(notice()).toBeNull();
  });

  it('offers a reload, and only on request, when the build has been replaced', async () => {
    serveAssets(404);
    const state = startHydration();
    await settle(5000);
    expect(fetch).toHaveBeenCalledWith(CATALOG_URL, expect.objectContaining({ method: 'HEAD', cache: 'no-store' }));
    expect(net.claim).not.toHaveBeenCalled();
    expect(net.reload).not.toHaveBeenCalled();

    button().click();
    await settle();
    expect(net.reload).toHaveBeenCalledOnce();
    expect(state.hydrated).toBe(false);
  });

  it('retries in place while the asset still exists, and offers a reload if that fails online', async () => {
    const state = startHydration();
    await settle(5000);
    button().click();
    await settle();
    expect(net.reload).not.toHaveBeenCalled();
    expect(state.hydrated).toBe(false);

    button().click();
    await settle();
    expect(net.reload).toHaveBeenCalledOnce();
  });

  it('does not reload when the connection is gone again', async () => {
    serveAssets(404);
    startHydration();
    await settle(5000);
    setOnline(false);
    button().click();
    await settle();
    expect(net.reload).not.toHaveBeenCalled();
  });
});

describe('a catalog that fails on navigation', () => {
  it('never reloads the document, and marks a replaced build for an explicit reload', async () => {
    serveAssets(404);
    getRouter();
    const { loadRouteDashboardLocale } = await import('@/lib/dashboard-locale-route');
    const failed = loadRouteDashboardLocale().catch((error: unknown) => error);
    await settle();
    expect(await failed).toMatchObject({ reloadRequired: true });
    expect(net.claim).not.toHaveBeenCalled();
  });

  it('keeps Try again in place for a connection failure', async () => {
    setOnline(false);
    const { loadRouteDashboardLocale } = await import('@/lib/dashboard-locale-route');
    const failed = loadRouteDashboardLocale().catch((error: unknown) => error);
    await settle();
    expect(await failed).toMatchObject({ reloadRequired: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('a chosen language whose catalog is gone', () => {
  const actionOfToast = async () => {
    await import('@/lib/dashboard-locale');
    net.failure = new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/de-OLD.js');
    net.languageFailure?.('de');
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    const [, options] = vi.mocked(toast.error).mock.calls[0] as unknown as [string, { action: { label: string; onClick: () => void } }];
    return options.action;
  };

  it('offers a reload that opens the new build in that language', async () => {
    vi.useRealTimers();
    serveAssets(404);
    const action = await actionOfToast();
    expect(action.label).toBe(common_refresh({}, { locale: 'ar' }));
    action.onClick();
    expect(net.remember).toHaveBeenCalledExactlyOnceWith('de');
    expect(net.reload).toHaveBeenCalledOnce();
    expect(net.setLanguage).not.toHaveBeenCalled();
  });

  it('offers the same choice again when the catalog still exists', async () => {
    vi.useRealTimers();
    const action = await actionOfToast();
    expect(action.label).toBe(translateStandalone('error.tryAgain', 'ar'));
    action.onClick();
    expect(net.setLanguage).toHaveBeenCalledExactlyOnceWith('de');
    expect(net.reload).not.toHaveBeenCalled();
  });
});
