import { configureDashboardLocaleLoading, dashboardLocaleFailure, prepareDashboardLocale } from '@nibleaf/i18n/dashboard-catalog';
import {
  getLocale,
  languageChoice,
  rememberInterfaceLocale,
  renderedLocale,
  setLanguage,
  subscribeLanguage,
  subscribeLanguageChoice,
  subscribeLanguageFailure,
} from '@nibleaf/i18n/locale-state';
import type { Locale } from '@nibleaf/i18n/locales';
import { common_refresh } from '@nibleaf/i18n/messages/common_refresh';
import { deploy_close } from '@nibleaf/i18n/messages/deploy_close';
import { translateStandalone } from '@nibleaf/i18n/standalone';
import { isBuildRetired } from '@/lib/build-retired';
import { currentRouteNeedsDashboardLocale } from '@/lib/dashboard-locale-boot';
import { reloadDocument, runOptionalLoad } from '@/lib/document-recovery';
import { showRecoveryNotice } from '@/lib/hydration-recovery';

/** How long to wait before each automatic retry while a document waits to hydrate. */
const HYDRATION_RETRY_DELAYS_MS = [500, 1500];

// Every catalog download is optional to the document: a failure is handled below
// or by the caller, and never reloads the page someone is reading.
configureDashboardLocaleLoading(runOptionalLoad, currentRouteNeedsDashboardLocale);

/** A page cannot render: its interface language could not be downloaded. */
export class DashboardLocaleUnavailableError extends Error {
  constructor(locale: Locale, cause: unknown) {
    super(`The ${locale} interface catalog could not be loaded`, { cause });
    this.name = 'DashboardLocaleUnavailableError';
  }
}

async function requireLocale(locale: Locale): Promise<void> {
  if (!(await prepareDashboardLocale(locale))) throw new DashboardLocaleUnavailableError(locale, dashboardLocaleFailure(locale));
}

/** Navigation uses the current choice. */
export const loadDashboardLocale = () => requireLocale(getLocale() as Locale);

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Resolves once the language the server rendered is available, so the first
 * client render matches its HTML. Until then the server HTML stays in place and
 * nothing reloads by itself: the page stays readable offline and retries when the
 * connection returns. When its build has been replaced, or a requested retry fails
 * while online, the notice's button loads the page again instead.
 */
export async function hydrateDashboardLocale(): Promise<void> {
  const locale = renderedLocale();
  let failure: unknown;
  const attempt = () =>
    requireLocale(locale).then(
      () => true,
      (error: unknown) => {
        failure = error;
        return false;
      },
    );
  if (await attempt()) return;
  for (const delay of HYDRATION_RETRY_DELAYS_MS) {
    await wait(delay);
    if (await attempt()) return;
  }
  let reload = await isBuildRetired(failure);
  await new Promise<void>((resolve) => {
    let busy = false;
    const showAction = () => {
      notice.action.textContent =
        reload && navigator.onLine !== false ? common_refresh({}, { locale }) : translateStandalone('error.tryAgain', locale);
    };
    const run = async (requested: boolean) => {
      if (busy) return;
      if (reload && navigator.onLine !== false) {
        if (requested) reloadDocument();
        return;
      }
      busy = true;
      notice.action.disabled = true;
      if (await attempt()) {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', showAction);
        // Removed before React continues, so it sees exactly the server's document.
        notice.remove();
        resolve();
        return;
      }
      reload = navigator.onLine !== false && (requested || (await isBuildRetired(failure)));
      busy = false;
      notice.action.disabled = false;
      showAction();
    };
    const onOnline = () => {
      showAction();
      void run(false);
    };
    const notice = showRecoveryNotice(locale, () => void run(true));
    showAction();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', showAction);
  });
}

let failedChoice: Locale | undefined;
let languageNotice: ReturnType<typeof showRecoveryNotice> | undefined;

const dismissLanguageNotice = () => {
  languageNotice?.remove();
  languageNotice = undefined;
};

/**
 * The latest language choice could not be downloaded, so the page stays as it is
 * and offers one action, drawn here because a toast's own chunks may be gone too.
 * It retries first. If that fails online, it offers Refresh, which saves the
 * choice and loads the current build: safe whether or not the build was replaced.
 * The action belongs to this request, and a later choice removes it.
 */
function offerLanguageRecovery(locale: Locale): void {
  const choice = languageChoice();
  const shownIn = getLocale() as Locale;
  const refresh = failedChoice === locale && navigator.onLine !== false;
  failedChoice = locale;
  dismissLanguageNotice();
  const notice = showRecoveryNotice(
    shownIn,
    () => {
      if (choice !== languageChoice()) {
        dismissLanguageNotice();
      } else if (refresh && navigator.onLine !== false) {
        rememberInterfaceLocale(locale);
        reloadDocument();
      } else {
        void setLanguage(locale);
      }
    },
    refresh ? common_refresh({}, { locale: shownIn }) : translateStandalone('error.tryAgain', shownIn),
  );
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'size-9 shrink-0 rounded-md';
  close.textContent = '×';
  close.setAttribute('aria-label', deploy_close({}, { locale: shownIn }));
  close.addEventListener('click', dismissLanguageNotice);
  notice.action.after(close);
  languageNotice = notice;
}

if (typeof document !== 'undefined') {
  subscribeLanguageFailure(offerLanguageRecovery);
  subscribeLanguageChoice((locale) => {
    dismissLanguageNotice();
    if (locale !== failedChoice) failedChoice = undefined;
  });
  subscribeLanguage(() => {
    failedChoice = undefined;
  });
}
