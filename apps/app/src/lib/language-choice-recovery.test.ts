// @vitest-environment jsdom
import { common_refresh } from '@nibleaf/i18n/messages/common_refresh';
import { translateStandalone } from '@nibleaf/i18n/standalone';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The real language runtime and cookie. Only the catalog downloads are scripted.
 * Sonner imports here but no toast host is mounted, as when its host chunk failed:
 * a toast would be queued and never seen.
 */
const net = vi.hoisted(() => ({ failure: undefined as unknown, reload: vi.fn() }));
vi.mock('@nibleaf/i18n/dashboard-catalog', () => ({
  configureDashboardLocaleLoading: vi.fn(),
  dashboardLocaleFailure: () => net.failure,
  prepareDashboardLocale: vi.fn(),
}));
vi.mock('@/lib/document-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/document-recovery')>()),
  reloadDocument: net.reload,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { registerLanguagePreparation, setLanguage } from '@nibleaf/i18n/locale-state';
import './dashboard-locale';

const NAMED_FAILURE = new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/ar-OLD.js');
const UNNAMED_FAILURE = new TypeError('Importing a module script failed.');

let prepare: (locale: string) => Promise<boolean>;
const notice = () => document.querySelector<HTMLElement>('[role="alert"]');
const action = () => notice()?.querySelector('button') as HTMLButtonElement;
const cookieLocale = () => /(?:NIBLEAF|PARAGLIDE)_LOCALE=([^;]+)/.exec(document.cookie)?.[1];
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const actionShown = () => vi.waitFor(() => expect(action()).toBeTruthy(), { timeout: 300 });
const failing =
  (...locales: string[]) =>
  async (locale: string) =>
    !locales.includes(locale);
const refreshLabel = () => common_refresh({}, { locale: 'en' });

beforeEach(async () => {
  document.documentElement.setAttribute('data-locale', 'en');
  registerLanguagePreparation((locale) => prepare(locale));
  prepare = async () => true;
  await setLanguage('en');
  document.body.replaceChildren();
  net.failure = NAMED_FAILURE;
  net.reload.mockClear();
  vi.mocked(toast.error).mockClear();
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-locale');
});

describe('recovery belongs to the language request that failed', () => {
  it('never offers an older failure after a newer choice succeeded', async () => {
    let answerHead!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answerHead = resolve;
          }),
      ),
    );
    prepare = failing('ar');
    await setLanguage('ar');
    await setLanguage('fr');
    answerHead?.(new Response(null, { status: 404 }));
    await settle();

    expect(toast.error).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
    expect(cookieLocale()).toBe('fr');
    expect(net.reload).not.toHaveBeenCalled();
  });

  it('removes the action as soon as another language is chosen, and ignores a late click', async () => {
    prepare = failing('ar');
    await setLanguage('ar');
    await actionShown();
    const stale = action();

    let finishFrench!: (ready: boolean) => void;
    prepare = () =>
      new Promise((resolve) => {
        finishFrench = resolve;
      });
    const french = setLanguage('fr');
    expect(notice()).toBeNull();
    stale.click();
    finishFrench(true);
    await french;

    expect(cookieLocale()).toBe('fr');
    expect(net.reload).not.toHaveBeenCalled();
  });
});

describe('a chosen language whose catalog keeps failing', () => {
  it('shows its action in the page, without depending on a toast host', async () => {
    prepare = failing('de');
    await setLanguage('de');
    await actionShown();
    expect(toast.error).not.toHaveBeenCalled();
    expect(notice()?.textContent).toContain(translateStandalone('error.unexpected', 'en'));
    expect(action().textContent).toBe(translateStandalone('error.tryAgain', 'en'));
    expect(document.documentElement.lang).toBe('en');
  });

  it.each([
    ['names no file and the old entry still answers 200', UNNAMED_FAILURE, 200],
    ['names a file that is gone', NAMED_FAILURE, 404],
  ])('turns into Refresh when a retry fails: %s', async (_case, failure, status) => {
    net.failure = failure;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
    const attempts: string[] = [];
    prepare = async (locale) => {
      attempts.push(locale);
      return false;
    };
    await setLanguage('de');
    await actionShown();
    action().click();
    await vi.waitFor(() => expect(action()?.textContent).toBe(refreshLabel()), { timeout: 300 });
    expect(attempts).toEqual(['de', 'de']);
    expect(net.reload).not.toHaveBeenCalled();

    action().click();
    expect(attempts).toHaveLength(2);
    expect(cookieLocale()).toBe('de');
    expect(net.reload).toHaveBeenCalledOnce();
  });

  it('stays an in-place retry while offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    prepare = failing('de');
    await setLanguage('de');
    await actionShown();
    action().click();
    await settle();
    expect(action().textContent).toBe(translateStandalone('error.tryAgain', 'en'));
    action().click();
    await settle();
    expect(net.reload).not.toHaveBeenCalled();
    expect(cookieLocale()).not.toBe('de');
  });

  it('starts over after the language loads, or for a different language', async () => {
    prepare = failing('de', 'ar');
    await setLanguage('de');
    await actionShown();
    await setLanguage('ar');
    await actionShown();
    expect(action().textContent).toBe(translateStandalone('error.tryAgain', 'en'));

    prepare = async () => true;
    action().click();
    await vi.waitFor(() => expect(document.documentElement.lang).toBe('ar'), { timeout: 300 });
    expect(notice()).toBeNull();

    prepare = failing('ar');
    await setLanguage('en');
    await setLanguage('ar');
    await actionShown();
    expect(action().textContent).toBe(translateStandalone('error.tryAgain', 'en'));
  });

  it('can be dismissed, keeping the current language', async () => {
    prepare = failing('de');
    await setLanguage('de');
    await actionShown();
    const close = notice()?.querySelector<HTMLButtonElement>('button[aria-label]') as HTMLButtonElement;
    close.click();
    expect(notice()).toBeNull();
    expect(document.documentElement.lang).toBe('en');
    expect(net.reload).not.toHaveBeenCalled();
  });
});

describe('a language chosen while the connection is down', () => {
  const setOnline = (online: boolean) => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  };

  it('offers nothing to press offline, and retries the choice when the connection returns', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    prepare = failing('ar');
    await setLanguage('ar');
    await actionShown();
    expect(action().disabled).toBe(true);

    prepare = async () => true;
    setOnline(true);
    await vi.waitFor(() => expect(document.documentElement.lang).toBe('ar'), { timeout: 300 });
    expect(notice()).toBeNull();
    expect(net.reload).not.toHaveBeenCalled();
  });

  it('disables a Refresh already shown when the connection drops, and never reloads offline', async () => {
    prepare = failing('de');
    await setLanguage('de');
    await actionShown();
    action().click();
    await vi.waitFor(() => expect(action()?.textContent).toBe(refreshLabel()), { timeout: 300 });

    setOnline(false);
    expect(action().disabled).toBe(true);
    action().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(net.reload).not.toHaveBeenCalled();
    expect(cookieLocale()).not.toBe('de');
  });

  it('does not retry an older choice on reconnect', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const attempts: string[] = [];
    prepare = async (locale) => {
      attempts.push(locale);
      return locale !== 'ar';
    };
    await setLanguage('ar');
    await actionShown();
    await setLanguage('fr');
    setOnline(true);
    await settle();
    expect(attempts).toEqual(['ar', 'fr']);
    expect(document.documentElement.lang).toBe('fr');
  });

  it('returns focus to the control that chose the language when the notice is closed', async () => {
    const trigger = document.body.appendChild(document.createElement('button'));
    trigger.focus();
    prepare = failing('de');
    await setLanguage('de');
    await actionShown();
    const close = notice()?.querySelector('button[aria-label]') as HTMLButtonElement;
    close.focus();
    close.click();
    expect(document.activeElement).toBe(trigger);
  });
});
