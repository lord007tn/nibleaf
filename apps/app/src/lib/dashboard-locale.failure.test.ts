// @vitest-environment jsdom
import { translateStandalone } from '@nibleaf/i18n/standalone';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({ prepare: vi.fn<(locale: string, options?: { required?: boolean }) => Promise<boolean>>(), configure: vi.fn() }));
const language = vi.hoisted(() => ({ failure: undefined as ((locale: string) => void) | undefined, set: vi.fn() }));
vi.mock('@nibleaf/i18n/dashboard-catalog', () => ({ prepareDashboardLocale: catalog.prepare, configureDashboardLocaleLoading: catalog.configure }));
vi.mock('@nibleaf/i18n/locale-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nibleaf/i18n/locale-state')>()),
  getLocale: () => 'de',
  renderedLocale: () => 'ar',
  setLanguage: language.set,
  subscribeLanguageFailure: (listener: (locale: string) => void) => {
    language.failure = listener;
    return () => undefined;
  },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { DashboardLocaleUnavailableError, hydrateDashboardLocale, loadDashboardLocale } from './dashboard-locale';

const notice = () => document.querySelector<HTMLElement>('[role="alert"]');
const retryButton = () => notice()?.querySelector('button') as HTMLButtonElement;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  catalog.prepare.mockReset();
  document.body.replaceChildren();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('hydrating a document whose catalog will not load', () => {
  it('hydrates at once when the server language is available, without a notice', async () => {
    catalog.prepare.mockResolvedValue(true);
    await hydrateDashboardLocale();
    expect(catalog.prepare).toHaveBeenCalledExactlyOnceWith('ar', { required: true });
    expect(notice()).toBeNull();
  });

  it('retries by itself before asking the visitor', async () => {
    catalog.prepare.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    let hydrated = false;
    void hydrateDashboardLocale().then(() => {
      hydrated = true;
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(hydrated).toBe(true);
    expect(catalog.prepare).toHaveBeenCalledTimes(3);
    expect(notice()).toBeNull();
  });

  it('keeps the server HTML unhydrated, in its language, until a retry succeeds', async () => {
    catalog.prepare.mockResolvedValue(false);
    document.body.innerHTML = '<main>نص من الخادم</main>';
    let hydrated = false;
    void hydrateDashboardLocale().then(() => {
      hydrated = true;
    });
    await vi.advanceTimersByTimeAsync(2000);

    expect(hydrated).toBe(false);
    expect(document.querySelector('main')?.textContent).toBe('نص من الخادم');
    expect(notice()?.lang).toBe('ar');
    expect(notice()?.textContent).toContain(translateStandalone('error.unexpected', 'ar'));
    expect(retryButton().textContent).toBe(translateStandalone('error.tryAgain', 'ar'));

    // A retry that fails leaves the way to try again.
    retryButton().click();
    expect(retryButton().disabled).toBe(true);
    await flush();
    expect(hydrated).toBe(false);
    expect(retryButton().disabled).toBe(false);

    catalog.prepare.mockResolvedValue(true);
    retryButton().click();
    await flush();
    expect(hydrated).toBe(true);
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
      let hydrated = false;
      void hydrateDashboardLocale().then(() => {
        hydrated = true;
      });
      await vi.advanceTimersByTimeAsync(2000);
      catalog.prepare.mockResolvedValue(true);
      retryButton().click();
      await flush();
      expect(hydrated).toBe(true);
      expect(notice()).toBeNull();
    } finally {
      document.removeEventListener('click', heldByReact, true);
    }
  });

  it('tries again when the connection returns', async () => {
    catalog.prepare.mockResolvedValue(false);
    let hydrated = false;
    void hydrateDashboardLocale().then(() => {
      hydrated = true;
    });
    await vi.advanceTimersByTimeAsync(2000);
    catalog.prepare.mockResolvedValue(true);
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(hydrated).toBe(true);
    expect(notice()).toBeNull();
  });
});

describe('navigating to a route whose catalog will not load', () => {
  it('rejects, so the route shows its error page instead of another language', async () => {
    catalog.prepare.mockResolvedValue(false);
    await expect(loadDashboardLocale()).rejects.toBeInstanceOf(DashboardLocaleUnavailableError);
    expect(catalog.prepare).toHaveBeenCalledExactlyOnceWith('de', { required: true });
  });

  it('continues once the catalog is available', async () => {
    catalog.prepare.mockResolvedValue(true);
    await expect(loadDashboardLocale()).resolves.toBeUndefined();
  });
});

describe('choosing a language that will not load', () => {
  it('tells the visitor and offers the same choice again', async () => {
    vi.useRealTimers();
    language.failure?.('fr');
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    const [message, options] = vi.mocked(toast.error).mock.calls[0] as unknown as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe(translateStandalone('error.unexpected', 'de'));
    expect(options.action.label).toBe(translateStandalone('error.tryAgain', 'de'));
    options.action.onClick();
    expect(language.set).toHaveBeenCalledExactlyOnceWith('fr');
  });
});
