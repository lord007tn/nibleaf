// Not @nibleaf/i18n/react: the root is in every published docs page's eager
// chunk, and that module brings the whole message catalog.
import { getLocale, renderedLocale, subscribeLanguage } from '@nibleaf/i18n/locale-state';
import { isRtl, type Locale } from '@nibleaf/i18n/locales';
import { type RouterState, useRouterState } from '@tanstack/react-router';
import { useState, useSyncExternalStore } from 'react';
import type { SiteShell } from '@/hooks/api/types';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The route renders the product UI (auth, dashboard, invitations) in the
     *  visitor's interface language, so `<html lang dir>` follows that locale. */
    interfaceLocale?: boolean;
  }
}

const SITE_ROUTE_ID = '/sites/$projectId';

/** What the root document (`<html lang dir>`, theme ownership) needs to know. */
export interface RootDocumentState {
  lang: string;
  dir: 'ltr' | 'rtl';
  pathname: string;
  /** Set while a published site owns the document, its theme included. */
  siteProjectId?: string;
  siteThemeDefault?: 'light' | 'dark' | 'system';
}

type Selected = RootDocumentState & {
  /** The reader route is matched but its shell hasn't loaded (yet): a language
   *  or version switch is fetching it again. */
  reloadingSiteProjectId?: string;
  /** A matched route renders the product UI in the interface language. */
  interfaceLocale?: boolean;
};

const selectRootDocument = (state: RouterState): Selected => {
  const pathname = state.location.pathname;
  const match = state.matches.find((m) => m.routeId === SITE_ROUTE_ID);
  const loaderData = match?.loaderData as { site?: SiteShell | null } | undefined;
  const site = loaderData?.site;
  if (!site) {
    const articleMatch = state.matches.find((m) => m.routeId === '/blog/$slug');
    const language = (articleMatch?.loaderData as { language?: 'ar' | 'en' } | undefined)?.language ?? 'en';
    const arabicMarketingRoute = pathname === '/ar' || pathname.startsWith('/ar/');
    const reloadingSiteProjectId = match && !loaderData ? (match.params as { projectId?: string }).projectId : undefined;
    if (!match && state.matches.some((m) => m.staticData?.interfaceLocale)) {
      return { lang: 'en', dir: 'ltr', pathname, interfaceLocale: true };
    }
    return language === 'ar' || arabicMarketingRoute
      ? { lang: 'ar', dir: 'rtl', pathname, reloadingSiteProjectId }
      : { lang: 'en', dir: 'ltr', pathname, reloadingSiteProjectId };
  }
  const code = (state.location.search as { lang?: string }).lang ?? site.activeLanguage;
  const active = site.languages.find((l) => l.code === code) ?? site.languages.find((l) => l.isDefault) ?? site.languages[0];
  return {
    lang: active?.code ?? 'en',
    dir: active?.direction === 'RTL' ? 'rtl' : 'ltr',
    pathname,
    siteProjectId: (match?.params as { projectId?: string } | undefined)?.projectId,
    siteThemeDefault: site.project.config?.styling?.theme ?? 'light',
  };
};

/**
 * Reflects a published site's active language on `<html lang/dir>` (so crawlers
 * and the first paint see e.g. lang="ar" dir="rtl") and tells the root whether
 * the site owns the document theme. Product routes (`staticData.interfaceLocale`)
 * take the visitor's interface language, which the server already renders.
 * Marketing routes keep en/ltr (ar/rtl for the Arabic marketing pages) and the
 * dashboard's theme.
 *
 * Switching language gives the reader route a new match, which the router can
 * show (after its pending delay) before the new shell has loaded. That moment
 * is still the same site: it keeps the site's last document state instead of
 * handing `<html>` to the dashboard, whose theme would otherwise follow the
 * OS and stay there (the reader's own theme effect has no reason to run again).
 */
export function useRootDocument(): RootDocumentState {
  const { reloadingSiteProjectId, interfaceLocale, ...current } = useRouterState({ select: selectRootDocument });
  const locale = useSyncExternalStore(subscribeLanguage, () => getLocale() as Locale, renderedLocale);
  const [lastSite, setLastSite] = useState<RootDocumentState>();
  if (interfaceLocale) return { ...current, lang: locale, dir: isRtl(locale) ? 'rtl' : 'ltr' };
  if (current.siteProjectId) {
    // Remember the site's document state (React's adjust-state-while-rendering
    // pattern: it only updates when a field changed, so it settles at once).
    if (
      lastSite?.siteProjectId !== current.siteProjectId ||
      lastSite.lang !== current.lang ||
      lastSite.dir !== current.dir ||
      lastSite.siteThemeDefault !== current.siteThemeDefault
    ) {
      setLastSite(current);
    }
    return current;
  }
  if (reloadingSiteProjectId && lastSite?.siteProjectId === reloadingSiteProjectId) {
    return { ...lastSite, pathname: current.pathname };
  }
  return current;
}
