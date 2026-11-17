/** Product routes which still translate through the complete dashboard key map. */
export const needsDashboardLocale = (pathname: string): boolean =>
  pathname === '/app' || pathname.startsWith('/app/') || pathname.startsWith('/git-preview/');
