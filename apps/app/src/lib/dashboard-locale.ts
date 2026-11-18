import { configureDashboardLocaleLoading, prepareDashboardLocale } from '@nibleaf/i18n/dashboard-catalog';
import { getLocale, renderedLocale, setLanguage, subscribeLanguageFailure } from '@nibleaf/i18n/locale-state';
import type { Locale } from '@nibleaf/i18n/locales';
import { translateStandalone } from '@nibleaf/i18n/standalone';
import { needsDashboardLocale } from '@/lib/dashboard-locale-path';
import { runOptionalLoad } from '@/lib/document-recovery';

/** How long to wait before each automatic retry while a document waits to hydrate. */
const HYDRATION_RETRY_DELAYS_MS = [500, 1500];

configureDashboardLocaleLoading(runOptionalLoad, () => needsDashboardLocale(window.location.pathname));

/** A route cannot render: its interface language could not be downloaded. */
export class DashboardLocaleUnavailableError extends Error {
  constructor(locale: Locale) {
    super(`The ${locale} interface catalog could not be loaded`);
    this.name = 'DashboardLocaleUnavailableError';
  }
}

/**
 * Route loaders wait for the current language. A failed download rejects, so
 * the route shows its error page (whose Try again runs this again) instead of
 * rendering the page in English for a visitor who chose another language.
 */
export async function loadDashboardLocale(): Promise<void> {
  const locale = getLocale() as Locale;
  if (!(await prepareDashboardLocale(locale, { required: true }))) throw new DashboardLocaleUnavailableError(locale);
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Shown over the server HTML until the catalog arrives. Plain DOM: React's root
 * already exists on the document and holds every click until hydration finishes,
 * so the button is handled on `window`, ahead of it.
 */
function waitForRetry(locale: Locale, prepare: () => Promise<boolean>): Promise<void> {
  return new Promise((resolve) => {
    const notice = document.createElement('div');
    notice.setAttribute('role', 'alert');
    notice.lang = locale;
    notice.className =
      'fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground text-sm shadow-lg';
    const message = document.createElement('p');
    message.textContent = translateStandalone('error.unexpected', locale);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'min-h-9 shrink-0 rounded-md border border-border px-3 font-medium disabled:opacity-60';
    retry.textContent = translateStandalone('error.tryAgain', locale);
    const onClick = (event: Event) => {
      if (event.target !== retry) return;
      event.stopPropagation();
      void attempt();
    };
    const attempt = async () => {
      if (retry.disabled) return;
      retry.disabled = true;
      if (await prepare()) {
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('online', attempt);
        // Removed before React starts, so hydration sees exactly the server's document.
        notice.remove();
        resolve();
        return;
      }
      retry.disabled = false;
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('online', attempt);
    notice.append(message, retry);
    document.body.append(notice);
  });
}

/**
 * Resolves once the language the server rendered is available, so the first
 * client render matches its HTML. If the download keeps failing the server HTML
 * stays in place, unhydrated, with a notice to try again; hydrating would replace
 * it with another language.
 */
export async function hydrateDashboardLocale(): Promise<void> {
  const locale = renderedLocale();
  const prepare = () => prepareDashboardLocale(locale, { required: true });
  if (await prepare()) return;
  for (const delay of HYDRATION_RETRY_DELAYS_MS) {
    await wait(delay);
    if (await prepare()) return;
  }
  await waitForRetry(locale, prepare);
}

// A language the visitor picked could not be downloaded: the page stays as it
// is, and the toast offers the same choice again.
if (typeof document !== 'undefined') {
  subscribeLanguageFailure((locale) => {
    runOptionalLoad(() => import('sonner')).then(
      ({ toast }) =>
        toast.error(translateStandalone('error.unexpected'), {
          action: { label: translateStandalone('error.tryAgain'), onClick: () => void setLanguage(locale) },
        }),
      () => undefined,
    );
  });
}
