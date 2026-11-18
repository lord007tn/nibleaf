const DASHBOARD_LOCALE_ROOTS = ['/app', '/git-preview', '/welcome/name', '/oauth', '/accept-invite', '/join'];

/** Product routes which translate through the dashboard key map, and so need
 *  the interface locale's catalog before they render (locale-boundary test). */
export const needsDashboardLocale = (pathname: string): boolean =>
  DASHBOARD_LOCALE_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
