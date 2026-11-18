// @vitest-environment jsdom
import { translateStandalone } from '@nibleaf/i18n/standalone';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({ prepare: vi.fn<(locale: string) => Promise<boolean>>(), configure: vi.fn() }));
vi.mock('@nibleaf/i18n/dashboard-catalog', () => ({
  prepareDashboardLocale: catalog.prepare,
  configureDashboardLocaleLoading: catalog.configure,
  dashboardLocaleFailure: () => new TypeError('fixture offline'),
}));
vi.mock('@nibleaf/i18n/locale-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/i18n/locale-state')>()),
  getLocale: () => 'de',
  renderedLocale: () => 'ar',
}));

import { DashboardLocaleUnavailableError, hydrateDashboardLocale, loadDashboardLocale } from './dashboard-locale';

const notice = () => document.querySelector<HTMLElement>('[role="alert"]');
const retryButton = () => notice()?.querySelector('button') as HTMLButtonElement;
const flush = () => vi.advanceTimersByTimeAsync(0);

function startHold() {
  const state = { hydrated: false };
  void hydrateDashboardLocale().then(() => {
    state.hydrated = true;
  });
  return state;
}

beforeEach(() => {
  catalog.prepare.mockReset();
  document.body.replaceChildren();
  vi.useFakeTimers();
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('hydrating a document whose catalog will not load', () => {
  it('hydrates at once when the server language is available, without a notice', async () => {
    catalog.prepare.mockResolvedValue(true);
    await hydrateDashboardLocale();
    expect(catalog.prepare).toHaveBeenCalledExactlyOnceWith('ar');
    expect(notice()).toBeNull();
  });

  it('retries by itself before asking the visitor', async () => {
    catalog.prepare.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const state = startHold();
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.hydrated).toBe(true);
    expect(catalog.prepare).toHaveBeenCalledTimes(3);
    expect(notice()).toBeNull();
  });

  it('keeps the server HTML unhydrated, in its language, until a retry succeeds', async () => {
    catalog.prepare.mockResolvedValue(false);
    document.body.innerHTML = '<main>نص من الخادم</main>';
    const state = startHold();
    await vi.advanceTimersByTimeAsync(2000);

    expect(state.hydrated).toBe(false);
    expect(document.querySelector('main')?.textContent).toBe('نص من الخادم');
    expect(notice()?.lang).toBe('ar');
    expect(notice()?.textContent).toContain(translateStandalone('error.unexpected', 'ar'));
    expect(retryButton().textContent).toBe(translateStandalone('error.tryAgain', 'ar'));

    catalog.prepare.mockResolvedValue(true);
    retryButton().click();
    expect(retryButton().disabled).toBe(true);
    await flush();
    expect(state.hydrated).toBe(true);
    // Gone before React compares the document with the server's HTML.
    expect(notice()).toBeNull();
  });

  it('keeps the retry working while React holds clicks on the document', async () => {
    // hydrateRoot(document) is already listening, and stops discrete events
    // aimed at content it has not hydrated yet.
    const heldByReact = (event: Event) => event.stopPropagation();
    document.addEventListener('click', heldByReact, true);
    try {
      catalog.prepare.mockResolvedValue(false);
      const state = startHold();
      await vi.advanceTimersByTimeAsync(2000);
      catalog.prepare.mockResolvedValue(true);
      retryButton().click();
      await flush();
      expect(state.hydrated).toBe(true);
      expect(notice()).toBeNull();
    } finally {
      document.removeEventListener('click', heldByReact, true);
    }
  });

  it('tries again when the connection returns', async () => {
    catalog.prepare.mockResolvedValue(false);
    const state = startHold();
    await vi.advanceTimersByTimeAsync(2000);
    catalog.prepare.mockResolvedValue(true);
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(state.hydrated).toBe(true);
    expect(notice()).toBeNull();
  });
});

describe('navigating to a route whose catalog will not load', () => {
  it('rejects, so the route shows its error page instead of another language', async () => {
    catalog.prepare.mockResolvedValue(false);
    await expect(loadDashboardLocale()).rejects.toBeInstanceOf(DashboardLocaleUnavailableError);
    expect(catalog.prepare).toHaveBeenCalledExactlyOnceWith('de');
  });

  it('continues once the catalog is available', async () => {
    catalog.prepare.mockResolvedValue(true);
    await expect(loadDashboardLocale()).resolves.toBeUndefined();
  });
});
