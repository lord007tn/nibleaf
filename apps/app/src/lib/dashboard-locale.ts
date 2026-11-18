import { configureDashboardLocaleLoading, dashboardLocaleFailure, prepareDashboardLocale } from '@nibleaf/i18n/dashboard-catalog';
import { getLocale, rememberInterfaceLocale, renderedLocale, setLanguage, subscribeLanguageFailure } from '@nibleaf/i18n/locale-state';
import type { Locale } from '@nibleaf/i18n/locales';
import { common_refresh } from '@nibleaf/i18n/messages/common_refresh';
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
        // Removed before React continues, so it sees exactly the server's document.
        notice.remove();
        resolve();
        return;
      }
      reload = navigator.onLine !== false && (requested || (await isBuildRetired(failure)));
      busy = false;
      notice.action.disabled = false;
    };
    const onOnline = () => void run(false);
    const notice = showRecoveryNotice(locale, () => void run(true));
    window.addEventListener('online', onOnline);
  });
}

/**
 * A language the visitor picked could not be downloaded, so the page stays as it
 * is. The same choice can be tried again, unless this tab's build was replaced:
 * its catalog will never return, so the action saves the choice and loads the
 * current build in that language.
 */
async function offerLanguageRecovery(locale: Locale): Promise<void> {
  const retired = await isBuildRetired(dashboardLocaleFailure(locale));
  const action = retired
    ? () => {
        rememberInterfaceLocale(locale);
        reloadDocument();
      }
    : () => void setLanguage(locale);
  const shownIn = getLocale() as Locale;
  try {
    const { toast } = await runOptionalLoad(() => import('sonner'));
    toast.error(translateStandalone('error.unexpected', shownIn), {
      action: { label: retired ? common_refresh({}, { locale: shownIn }) : translateStandalone('error.tryAgain', shownIn), onClick: action },
    });
  } catch {
    // The toast's own chunk can be gone from the same replaced build.
    const notice = showRecoveryNotice(shownIn, () => {
      notice.remove();
      action();
    });
  }
}

if (typeof document !== 'undefined') {
  subscribeLanguageFailure((locale) => void offerLanguageRecovery(locale));
}
