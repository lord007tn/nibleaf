import { renderedLocale } from '@nibleaf/i18n/locale-state';
import { translateStandalone } from '@nibleaf/i18n/standalone';
import type { AnyRoute, AnyRouter } from '@tanstack/react-router';
import { reloadDocument, runOptionalLoad } from '@/lib/document-recovery';

let activeRouter: AnyRouter | undefined;

export const trackDashboardLocaleRouter = (router: AnyRouter): void => {
  activeRouter = router;
};

/** Asks the router itself, so every URL form it accepts (letter case, a trailing
 *  slash, escapes, custom-domain rewrites) gets the same answer as its matching. */
export const currentRouteNeedsDashboardLocale = (): boolean =>
  Boolean(
    activeRouter?.getMatchedRoutes(activeRouter.latestLocation.pathname)[0].some((route: AnyRoute) => route.options.staticData?.dashboardLocale),
  );

/** The bootstrap is optional to the page: its failure never reloads the document.
 *  Vite resolves a cancelled speculative failure with nothing. */
export const dashboardLocaleModule = () => runOptionalLoad(() => import('@/lib/dashboard-locale'));

/** Plain DOM for when no other chunk can load. React's root may already hold
 *  clicks on the document, so the button is handled on `window`, ahead of it. */
function showRefreshNotice(label: string | undefined) {
  const notice = document.createElement('div');
  const action = document.createElement('button');
  notice.setAttribute('role', 'alert');
  notice.className = 'fixed bottom-4 start-4 z-50 flex items-center gap-3 rounded-lg border bg-card p-3 text-sm';
  action.className = 'rounded-md border px-3 py-1';
  action.textContent = label ?? '';
  notice.append(translateStandalone('error.unexpected', renderedLocale()), action);
  document.body.append(notice);
  // Never reload an offline tab: it would lose the readable server page.
  window.addEventListener('click', (event) => event.target === action && navigator.onLine && reloadDocument(), true);
  window.addEventListener('offline', () => {
    action.hidden = true;
  });
  return { notice, action };
}

/**
 * Keeps the server HTML while the locale bootstrap cannot be fetched, retrying
 * on a timer and when the connection returns. This stays small because every
 * page loads it: the bootstrap handles a missing catalog itself. Online, the
 * notice offers Refresh, in the words the server sent with this document, since
 * the bootstrap may belong to a replaced build.
 */
export async function holdHydrationForDashboardLocale(refreshLabel?: string): Promise<void> {
  let shown: ReturnType<typeof showRefreshNotice> | undefined;
  for (let attempt = 0; ; attempt += 1) {
    const module = await dashboardLocaleModule().catch(() => undefined);
    if (module) {
      shown?.notice.remove();
      return module.hydrateDashboardLocale();
    }
    if (attempt > 1) {
      shown ??= showRefreshNotice(refreshLabel);
      shown.action.hidden = !refreshLabel || !navigator.onLine;
    }
    await new Promise<void>((resolve) => {
      window.addEventListener('online', () => resolve(), { once: true });
      setTimeout(resolve, attempt < 2 ? 1000 : 5000);
    });
  }
}
