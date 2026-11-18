import { renderedLocale } from '@nibleaf/i18n/locale-state';
import type { AnyRouter } from '@tanstack/react-router';
import { DASHBOARD_LOCALE_ROUTE_IDS } from '@/lib/dashboard-locale-routes';
import { reloadDocument, runOptionalLoad } from '@/lib/document-recovery';
import { showRecoveryNotice } from '@/lib/hydration-recovery';

let activeRouter: AnyRouter | undefined;

export const trackDashboardLocaleRouter = (router: AnyRouter): void => {
  activeRouter = router;
};

/** Asks the router itself, so every URL form it accepts (letter case, a trailing
 *  slash, escapes, custom-domain rewrites) gets the same answer as its matching. */
export const currentRouteNeedsDashboardLocale = (): boolean =>
  Boolean(
    activeRouter?.getMatchedRoutes(activeRouter.latestLocation.pathname)[0].some((route: { id: string }) => DASHBOARD_LOCALE_ROUTE_IDS.has(route.id)),
  );

/** The bootstrap is optional to the page: its failure never reloads the document.
 *  Vite resolves a cancelled speculative failure with nothing. */
export async function dashboardLocaleModule() {
  const module = await runOptionalLoad(() => import('@/lib/dashboard-locale'));
  if (!module) throw new Error('The interface language module did not load');
  return module;
}

/**
 * Keeps the server HTML while the locale bootstrap cannot be fetched, retrying
 * on a timer and when the connection returns. This stays small because every
 * page loads it: the bootstrap handles a missing catalog itself. Online, the
 * notice's button reloads, since the bootstrap may belong to a replaced build.
 */
export async function holdHydrationForDashboardLocale(): Promise<void> {
  let notice: ReturnType<typeof showRecoveryNotice> | undefined;
  let wake: (() => void) | undefined;
  for (let attempt = 0; ; attempt += 1) {
    let module: Awaited<ReturnType<typeof dashboardLocaleModule>> | undefined;
    try {
      module = await dashboardLocaleModule();
    } catch {
      // Retried below.
    }
    if (module) {
      notice?.remove();
      return module.hydrateDashboardLocale();
    }
    if (attempt === 2) notice = showRecoveryNotice(renderedLocale(), () => (navigator.onLine === false ? wake?.() : reloadDocument()));
    await new Promise<void>((resolve) => {
      wake = resolve;
      window.addEventListener('online', () => resolve(), { once: true });
      setTimeout(resolve, attempt < 2 ? 500 + attempt * 1000 : 5000);
    });
  }
}
