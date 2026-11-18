import { getLocale } from '@nibleaf/i18n/locale-state';
import type { Locale } from '@nibleaf/i18n/locales';
import { common_refresh } from '@nibleaf/i18n/messages/common_refresh';
import { isBuildRetired } from '@/lib/build-retired';
import { dashboardLocaleModule } from '@/lib/dashboard-locale-boot';

let failedOnline = false;

/**
 * Route loaders wait for the current language. A failure reaches the route's
 * error page rather than rendering another language. `reloadLabel` makes that
 * page offer Refresh: when the build was replaced, or a retry failed online.
 */
export async function loadRouteDashboardLocale(): Promise<void> {
  try {
    const module = await dashboardLocaleModule();
    if (!module) throw new Error('The interface language module did not load');
    await module.loadDashboardLocale();
    failedOnline = false;
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const retryFailed = failedOnline && navigator.onLine !== false;
    failedOnline = navigator.onLine !== false;
    const reload = retryFailed || (await isBuildRetired(cause));
    throw Object.assign(error, { reloadLabel: reload ? common_refresh({}, { locale: getLocale() as Locale }) : undefined });
  }
}
