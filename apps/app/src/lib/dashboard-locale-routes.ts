/** Product routes which translate through the dashboard key map, and so need the
 *  interface locale's catalog before they render. At runtime each one says so with
 *  `staticData.dashboardLocale`; this list lets the bundle check and the
 *  locale-boundary test verify that without loading the routes. */
const DASHBOARD_LOCALE_ROUTE_IDS = new Set([
  '/app',
  '/git-preview/$token',
  '/welcome/name',
  '/oauth/consent',
  '/oauth/project',
  '/accept-invite/$invitationId',
  '/join/$token',
]);

/** Whether a route, or a route nested under the dashboard, needs that catalog. */
export const isDashboardLocaleRouteId = (routeId: string): boolean => DASHBOARD_LOCALE_ROUTE_IDS.has(routeId) || routeId.startsWith('/app/');
