import { isBuildRetired } from '@/lib/build-retired';
import { dashboardLocaleModule } from '@/lib/dashboard-locale-boot';

/**
 * Route loaders wait for the current language. A failure reaches the route's
 * error page rather than rendering another language. `reloadRequired` tells that
 * page its Try again must load the current build instead of repeating the request.
 */
export async function loadRouteDashboardLocale(): Promise<void> {
  try {
    await (await dashboardLocaleModule()).loadDashboardLocale();
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    throw Object.assign(error, { reloadRequired: await isBuildRetired(cause) });
  }
}
