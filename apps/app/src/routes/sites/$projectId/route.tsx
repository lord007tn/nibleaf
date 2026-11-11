import { cn } from '@nibleaf/design-system/lib/utils';
import { THEME_STORAGE_KEY } from '@nibleaf/design-system/theme';
import { isRtl as isRtlLocale, resolveLocale } from '@nibleaf/i18n/locales';
import { deploy_close } from '@nibleaf/i18n/messages';
import { siteT } from '@nibleaf/i18n/site';
import { createFileRoute, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { BookOpen, ExternalLink, Link2, Moon, Search, Sun } from 'lucide-react';
import { lazy, type MouseEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { askSearchSchema } from '@/components/site/ai-chat/ask-search';
import { ChatSearchBridge, SiteChatReaderLayout } from '@/components/site/ai-chat/provider';
import { DocumentationThemeProvider } from '@/components/site/documentation-theme-provider';
import { LanguageSwitcher } from '@/components/site/language-switcher';
import { MadeWithBadge } from '@/components/site/made-with-badge';
import { MobileNav, type MobileNavChoice } from '@/components/site/mobile-nav';
import { type SiteLanguageAlternate, SitePageAlternatesContext } from '@/components/site/page-alternates-context';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { SiteAnalyticsConsent } from '@/components/site/site-analytics-consent';
import { SiteBanner } from '@/components/site/site-banner';
import { firstLeafPath, isVersionIndependentNavNode, leadingPages, SiteNav } from '@/components/site/site-nav';
import type { PrivateSiteGate } from '@/components/site/site-private-gate';
import { SiteReaderContext, type SiteReaderContextValue } from '@/components/site/site-reader-context';
import { openSiteSearch, preloadSiteSearch, SiteSearch } from '@/components/site/site-search';
import { SiteSignOut } from '@/components/site/site-sign-out';
import { VersionSwitcher } from '@/components/site/version-switcher';
import { getSiteFn } from '@/functions/site';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import type { ProjectConfig, SiteShell } from '@/hooks/api/types';
import { useSearchShortcutLabel } from '@/lib/shortcut';
import { publishedSiteLogo } from '@/lib/site-branding';
import { useSiteLinkNavigation } from '@/lib/site-link-navigation';
import { customDomainOrigin } from '@/lib/site-origin';
import { safeDecode, siteHref, siteLanguageParam, siteRoutePath } from '@/lib/site-paths';
import { readerFallbackHead, siteEmoji, siteHead, siteIconHref, siteRobotsHeaders, unavailableSiteHead } from '@/lib/site-seo';
import { readSiteStorage, writeSiteStorage } from '@/lib/site-storage';
import { projectThemeCss, projectThemeStyle, resolveProjectTheme } from '@/lib/site-theme';
import { SiteAnalyticsProvider } from '@/providers/site-analytics-provider';

// Only visitors of a private site need this screen's copy.
const SitePrivateGate = lazy(() => import('@/components/site/site-private-gate'));

export const Route = createFileRoute('/sites/$projectId')({
  component: SiteRoute,
  // The active language lives in the URL so it survives reloads and is shareable.
  validateSearch: (search) => z.object({ lang: z.string().min(1).optional().catch(undefined), ask: askSearchSchema }).parse(search),
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // Version changes explicitly invalidate this shell; ordinary page clicks reuse it.
  shouldReload: false,
  // Fetch the site shell on the server so the chrome (nav, branding) is in the
  // initial HTML; the result also feeds site-level SEO tags via head(). The
  // first path segment is passed as a version candidate so versioned URLs
  // (`/sites/:id/v2/...`) SSR with that version's nav — the server ignores
  // candidates that aren't real version slugs.
  loader: async ({ params, deps, location }) => {
    try {
      const rest = siteRoutePath(location.pathname).replace(/\/+$/, '');
      const segment = rest.split('/')[0];
      const candidate = segment && rest !== 'changelog' ? safeDecode(segment) : undefined;
      const site = await getSiteFn({ data: { projectId: params.projectId, language: deps.lang, version: candidate } });
      return { site, siteOrigin: customDomainOrigin() };
    } catch (error) {
      if (!(error instanceof ApiResponseError) || error.status !== 404) throw error;
      // The API names why the shell is hidden. A private site gets its own
      // sign-in screen; every other cause keeps the not-published screen.
      // A private site's sign-in screen shows the site's own name, logo and colours.
      if (error.reason === 'private') {
        return {
          site: null,
          siteOrigin: customDomainOrigin(),
          unavailable: 'private' as const,
          gate: error.details?.gate as PrivateSiteGate | undefined,
        };
      }
      return { site: null, siteOrigin: customDomainOrigin(), unavailable: undefined };
    }
  },
  headers: ({ loaderData }) => (loaderData ? siteRobotsHeaders(loaderData.site) : undefined),
  head: ({ loaderData, match, matches }) => {
    const lang = (match.search as { lang?: string }).lang;
    // The shell failed to load (not a 404): still give the tab a title.
    if (!loaderData) return readerFallbackHead(matches, lang);
    return loaderData.site
      ? siteHead(loaderData.site, loaderData.siteOrigin)
      : // A private or unpublished site still gets a readable tab title, never indexed.
        unavailableSiteHead(loaderData.unavailable, lang ?? ('gate' in loaderData ? loaderData.gate?.language?.code : undefined));
  },
});

function SiteRoute() {
  return <SiteChrome />;
}

// Brand glyphs as inline SVG — lucide-react no longer ships GitHub/X/LinkedIn icons.
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.21 11.19.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.34-1.73-1.34-1.73-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.22 1.84 1.22 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.58-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.23-3.17-.12-.3-.53-1.52.12-3.16 0 0 1-.32 3.3 1.21a11.6 11.6 0 0 1 6 0c2.3-1.53 3.3-1.21 3.3-1.21.65 1.64.24 2.86.12 3.16.77.83 1.23 1.88 1.23 3.17 0 4.53-2.81 5.53-5.49 5.82.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .31.21.68.83.56A12.04 12.04 0 0 0 24 12.29C24 5.78 18.63.5 12 .5Z" />
    </svg>
  );
}
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}
function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14Zm1.78 13.02H3.56V9h3.56v11.45ZM22.22 0H1.77C.8 0 0 .78 0 1.74v20.51C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.74C24 .78 23.2 0 22.22 0Z" />
    </svg>
  );
}

function SiteChrome() {
  const { projectId } = Route.useParams();
  const { lang, ask } = Route.useSearch();
  const loaderData = Route.useLoaderData();
  const site = loaderData.site;
  const unavailable = 'unavailable' in loaderData ? loaderData.unavailable : undefined;
  const privateGate = 'gate' in loaderData ? loaderData.gate : undefined;
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  // Only a public site with no reader session may be prefetched and cached
  // between navigations (lib/reader-site-access.ts); anything else, or no shell, fails closed.
  const announcement = useSiteLinkNavigation(projectId, {
    publicSite: site?.project.config?.visibility === 'public' && !site?.signedIn,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [pageAlternates, setPageAlternates] = useState<SiteLanguageAlternate[]>([]);
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState<number>();
  const observeHeader = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }
    const measure = () => setMeasuredHeaderHeight(node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // SSR renders the platform-neutral label; the client corrects it after hydration.
  const searchShortcut = useSearchShortcutLabel();
  const committedLocation = useRouterState({ select: (s) => s.resolvedLocation ?? s.location });
  const pathname = committedLocation.pathname;
  const currentPath = safeDecode(siteRoutePath(pathname)).replace(/\/+$/, '');
  const isChangelog = currentPath === 'changelog';
  const currentVersion = site?.versions.find((item) => item.slug === site.activeVersion) ?? site?.versions.find((item) => item.isDefault);
  const pathVersion = site?.versions.find((item) => item.slug === currentPath.split('/')[0]);
  const resolvedVersion = pathVersion ?? site?.versions.find((item) => item.isDefault);
  const resolvedVersionSlug = resolvedVersion?.slug;
  const attemptedVersion = useRef<{ key: string; site: SiteShell } | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new pathname retries an interrupted fetch for the same version.
  useEffect(() => {
    if (!site || !resolvedVersionSlug) return;
    if (site.activeVersion === resolvedVersionSlug) {
      attemptedVersion.current = undefined;
      return;
    }
    const attempt = JSON.stringify([projectId, lang, resolvedVersionSlug]);
    const previous = attemptedVersion.current;
    // A fresh shell can refuse a version; an unchanged shell can mean an interrupted fetch.
    if (previous?.key === attempt && previous.site !== site) return;
    attemptedVersion.current = { key: attempt, site };
    void router.invalidate({ filter: (match) => match.routeId === Route.id, sync: true });
  }, [site, resolvedVersionSlug, pathname, router, projectId, lang]);
  const activeVersionPrefix = currentVersion && !currentVersion.isDefault ? currentVersion.slug : undefined;
  const contentPath = pathVersion ? currentPath.slice(pathVersion.slug.length).replace(/^\/+/, '') : currentPath;
  // The home route (empty path) renders the site's first page server-side, so
  // highlight that page's nav entry rather than leaving the sidebar inert.
  const effectiveCurrentPath = contentPath || firstLeafPath(site?.nav ?? []) || '';
  const shellMatchesVersion = !resolvedVersionSlug || site?.activeVersion === resolvedVersionSlug;
  const analyticsPath = contentPath || (shellMatchesVersion ? effectiveCurrentPath : '');

  const config: ProjectConfig | null = site?.project.config ?? null;
  const languages = site?.languages ?? [];
  const versions = site?.versions ?? [];
  // Resolve the active language: URL param → server-reported active → default → first.
  const activeLanguage = useMemo(() => {
    const code = lang ?? site?.activeLanguage;
    return languages.find((language) => language.code === code) ?? languages.find((language) => language.isDefault) ?? languages[0];
  }, [languages, lang, site?.activeLanguage]);
  const isRtl = activeLanguage?.direction === 'RTL';
  const defaultLanguage = languages.find((language) => language.isDefault)?.code;
  const committedLanguage = (committedLocation.search as { lang?: string }).lang;
  const analyticsLanguage = languages.find((language) => language.code === committedLanguage)?.code ?? defaultLanguage;
  const navigationLanguage = siteLanguageParam(activeLanguage?.code, defaultLanguage);
  // Chrome strings follow the active language so an Arabic site reads Arabic.
  // Without a shell (a private or unpublished site) only `?lang=` is known.
  const t = siteT(activeLanguage?.code ?? lang);

  // The published site manages its OWN light/dark theme (a class on the chrome
  // below), independent of the dashboard's theme — so the site's config default
  // and a visitor's toggle never clobber the editor/dashboard theme.
  const configTheme = config?.styling?.theme; // 'light' | 'dark' | 'system' | undefined
  const [siteTheme, setSiteTheme] = useState<'light' | 'dark'>(configTheme === 'dark' ? 'dark' : 'light');
  const [siteThemeHydratedFor, setSiteThemeHydratedFor] = useState<string>();
  const hasExplicitThemeChoice = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storageKey = `nibleaf.site.theme.${projectId}`;
    const stored = readSiteStorage('localStorage', storageKey);
    hasExplicitThemeChoice.current = stored === 'dark' || stored === 'light';
    // An explicit visitor choice always wins over the configured default.
    if (stored === 'dark' || stored === 'light') {
      setSiteTheme(stored);
      setSiteThemeHydratedFor(projectId);
      return;
    }
    // 'system' follows the visitor's OS preference, and keeps following it live
    // until the visitor toggles (which stores an explicit choice the guard below
    // then respects). 'light'/'dark' apply the configured default directly.
    if (configTheme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setSiteTheme(mq.matches ? 'dark' : 'light');
      setSiteThemeHydratedFor(projectId);
      const onChange = (e: MediaQueryListEvent) => {
        if (hasExplicitThemeChoice.current || readSiteStorage('localStorage', storageKey)) {
          return;
        }
        setSiteTheme(e.matches ? 'dark' : 'light');
      };
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    setSiteTheme(configTheme === 'dark' ? 'dark' : 'light');
    setSiteThemeHydratedFor(projectId);
  }, [projectId, configTheme]);
  const toggleSiteTheme = () => {
    const next = siteTheme === 'dark' ? 'light' : 'dark';
    hasExplicitThemeChoice.current = true;
    writeSiteStorage('localStorage', `nibleaf.site.theme.${projectId}`, next);
    setSiteTheme(next);
  };

  // The site is a full-page route, so it OWNS the document theme while mounted.
  // Drive `.dark` on <html> from siteTheme (not just a class on the chrome): the
  // design-system dark tokens key off any `.dark` ancestor, so a chrome-only
  // class can force dark but can never force light while <html>.dark is set by
  // the dashboard ThemeProvider. Capture the dashboard's theme on mount and
  // restore it on unmount so leaving the site doesn't flip the dashboard.
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    const dashboardTheme = readSiteStorage('localStorage', THEME_STORAGE_KEY);
    const dashboardUsesSystem = dashboardTheme !== 'light' && dashboardTheme !== 'dark';
    const dashboardWasDark = dashboardTheme === 'dark' || (dashboardUsesSystem && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const dashboardResolvedTheme = dashboardWasDark ? 'dark' : 'light';
    return () => {
      root.classList.remove('light', 'dark');
      root.classList.add(dashboardResolvedTheme);
      root.style.colorScheme = dashboardResolvedTheme;
    };
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined' || siteThemeHydratedFor !== projectId) {
      return;
    }
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(siteTheme);
    document.documentElement.style.colorScheme = siteTheme;
  }, [projectId, siteTheme, siteThemeHydratedFor]);

  // Apply the site's own icon on client navigations (siteHead sets it for SSR).
  // A site with no favicon or logo shows no icon rather than Nibleaf's.
  const faviconUrl = siteIconHref(config);
  useEffect(() => {
    if (typeof document === 'undefined' || !site) {
      return;
    }
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }, [faviconUrl, site]);

  // (The document <html lang/dir> is set server-side in __root's RootDocument
  // from this route's resolved language, so crawlers + first paint are correct.)
  // (The changelog route now owns its own SSR <title>/description/canonical via
  // its head(), so there's no client-side title patching here.)

  const pageAlternatesContext = useMemo(() => ({ alternates: pageAlternates, setAlternates: setPageAlternates }), [pageAlternates]);
  // Search is on by default; only an explicit `false` hides it.
  const showSearch = config?.navbar?.showSearch !== false;
  // Outlet content (the site 404) links home and opens search through this.
  const readerLanguage = activeLanguage?.code;
  const readerHomeHref = siteHref(projectId, '', { lang: navigationLanguage, version: activeVersionPrefix });
  // React Compiler memoizes this value; a manual useMemo here blocks compilation.
  const readerContext: SiteReaderContextValue = {
    lang: readerLanguage,
    languages,
    homeHref: readerHomeHref,
    openSearch: showSearch ? () => openSiteSearch(() => setSearchOpen(true), t('searchDocumentation')) : undefined,
  };

  if (!site) {
    // No shell means no site languages: follow `?lang=` for text and direction.
    const shelllessLocale = resolveLocale(lang) ?? 'en';
    if (unavailable === 'private') {
      return (
        <Suspense fallback={<div className="min-h-screen bg-background" />}>
          <SitePrivateGate gate={privateGate} lang={lang} projectId={projectId} />
        </Suspense>
      );
    }
    return (
      <div
        className="grid min-h-screen place-items-center bg-background px-6 text-center"
        lang={shelllessLocale}
        dir={isRtlLocale(shelllessLocale) ? 'rtl' : 'ltr'}
      >
        <div>
          <BookOpen className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <h1 className="mt-4 font-semibold text-2xl tracking-tight">{t('notPublishedTitle')}</h1>
          <p className="mt-2 max-w-sm text-muted-foreground text-sm">{t('notPublishedBody')}</p>
        </div>
      </div>
    );
  }

  const resolvedTheme = resolveProjectTheme(config);
  const searchHotkey = config?.search?.hotkey;
  const navLinks = config?.navbar?.links ?? [];
  const navTabs = config?.navbar?.tabs ?? [];
  const navAnchors = config?.navbar?.anchors ?? [];
  const ctaLabel = config?.navbar?.ctaLabel;
  const ctaUrl = config?.navbar?.ctaUrl;
  const footer = config?.footer;
  // "Made with Nibleaf" attribution is on by default.
  const showBadge = footer?.madeWithBadge !== false;
  const hasFooterContent = Boolean(footer && (footer.copyright || footer.github || footer.x || footer.linkedin));

  // Branding can provide a theme-specific logo and an optional off-site link.
  const branding = config?.branding;
  const configuredLogo = (siteTheme === 'dark' ? branding?.logoDark || branding?.logoLight : branding?.logoLight) || null;
  const logo = publishedSiteLogo(configuredLogo, siteTheme);
  const logoHref = branding?.logoHref?.trim() || undefined;

  // --site-header-h drives every sticky offset (sidebar, TOC, heading scroll
  // margins), including the optional tab row.
  const headerHeight = measuredHeaderHeight === undefined ? (navTabs.length > 0 ? '6.75rem' : '4rem') : `${measuredHeaderHeight}px`;
  const chromeStyle = {
    ...projectThemeStyle(config),
    '--site-header-h': headerHeight,
    '--content-scroll-mt': `calc(${headerHeight} + 1.5rem)`,
  } as Record<string, string | number>;
  const themeCss = projectThemeCss(config);
  // The active language may localize the site name (brand + footer copyright).
  const siteName = site?.languageConfig?.name || site?.project.name;
  const brandInner = (
    <>
      {logo ? (
        <>
          <img
            src={logo.src}
            alt={siteName ?? t('logo')}
            className={cn('object-contain', logo.markOnly ? 'size-7 shrink-0' : 'h-6 w-auto max-w-full')}
          />
          {logo.markOnly ? null : <span className="truncate">{siteName ?? t('documentation')}</span>}
        </>
      ) : (
        <>
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground text-sm">
            {siteEmoji(site.project.icon) || (siteName || t('documentation'))[0]}
          </span>
          <span className="truncate">{siteName ?? t('documentation')}</span>
        </>
      )}
    </>
  );

  const changeLanguage = (code: string) => {
    const targetLanguage = siteLanguageParam(code, defaultLanguage);
    const alternate = pageAlternates.find((item) => item.code === code && item.path);
    if (!isChangelog && alternate?.path) {
      navigate({ href: siteHref(projectId, alternate.path, { lang: targetLanguage, version: activeVersionPrefix }) });
      return;
    }
    // No known translation path (the changelog, the API reference, a 404, an
    // untranslated page, or alternates not reported yet): keep the reader on
    // the same URL, version prefix included, in the other language. A
    // search-only navigate from this layout route would resolve to the site
    // root instead.
    navigate({ href: siteHref(projectId, currentPath, { lang: targetLanguage }) });
  };
  const changeVersion = (slug: string) => {
    const defaultVersion = versions.find((item) => item.isDefault);
    const targetPrefix = defaultVersion?.slug === slug ? '' : slug;
    const targetPath = [targetPrefix, isChangelog ? '' : contentPath].filter(Boolean).join('/');
    navigate({ href: siteHref(projectId, targetPath, { lang: navigationLanguage }) });
  };
  const activeVersion = site?.activeVersion ?? versions.find((item) => item.isDefault)?.slug ?? '';
  const sitePath = (path = '') => siteHref(projectId, path, { lang: navigationLanguage, version: activeVersionPrefix });
  const searchSuggestions = leadingPages(site.nav ?? [], 5).map((node) => ({
    title: node.title,
    path: node.path,
    icon: node.icon,
    versionIndependent: isVersionIndependentNavNode(node),
  }));
  // Phones keep the header to one row, so these switchers live in the drawer there.
  const mobileChoices: MobileNavChoice[] = [
    {
      id: 'language',
      label: t('language'),
      value: activeLanguage?.code ?? '',
      options: languages.map((language) => ({
        value: language.code,
        label: language.label,
        lang: language.code,
        dir: language.direction === 'RTL' ? 'rtl' : 'ltr',
      })),
      onChange: changeLanguage,
    },
    {
      id: 'version',
      label: t('version'),
      value: activeVersion,
      options: versions.map((version) => ({
        value: version.slug,
        label: version.isDefault ? `${version.name} (${t('defaultVersion')})` : version.name,
      })),
      onChange: changeVersion,
    },
  ];
  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    // Move focus without a hash navigation, which the router would treat as a visit.
    const target = document.getElementById('site-content');
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  // Only configured navigation renders — the chrome imposes no IA of its own.
  // Root-relative hrefs are site-internal: resolve them to the site base (and
  // keep the active language/version) so `/guides`-style links work on both
  // path-based (/sites/:id) and custom-domain serving.
  const resolveNavHref = (href: string): string =>
    href.startsWith('/') && !href.startsWith('//') ? siteHref(projectId, href, { lang: navigationLanguage, version: activeVersionPrefix }) : href;
  const isNavActive = (href: string): boolean => {
    if (!href.startsWith('/') || href.startsWith('//')) {
      return false;
    }
    const prefix = href.replace(/^\/+|\/+$/g, '');
    return prefix !== '' && (effectiveCurrentPath === prefix || effectiveCurrentPath.startsWith(`${prefix}/`));
  };
  // The built-in (localized) Changelog link is opt-in via navbar.changelog —
  // not every product wants its release history in the navbar. The header and
  // the mobile drawer render the same list.
  const headerLinks = [
    ...(config?.navbar?.changelog === true
      ? [{ label: t('changelog'), href: siteHref(projectId, 'changelog', { lang: navigationLanguage }), active: isChangelog, external: false }]
      : []),
    ...navLinks.map((link) => ({
      label: link.label,
      href: resolveNavHref(link.href),
      active: !link.external && isNavActive(link.href),
      external: Boolean(link.external),
    })),
  ];

  return (
    <SiteAnalyticsProvider projectId={projectId} path={analyticsPath} language={analyticsLanguage} version={resolvedVersionSlug} config={config}>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-site-route-announcer>
        {announcement}
      </div>
      {/* `dir` flips the whole document tree for RTL languages; code blocks are forced back to LTR via the scoped rule below. */}
      <DocumentationThemeProvider
        appearance={siteTheme}
        className="flex min-h-screen flex-col bg-background [&_code]:[direction:ltr] [&_pre]:[direction:ltr]"
        context="reader"
        css={themeCss}
        direction={isRtl ? 'rtl' : 'ltr'}
        style={chromeStyle}
        theme={resolvedTheme}
      >
        {/* First focusable element: keyboard readers can jump past the header and sidebar. */}
        {/* biome-ignore lint/a11y/useValidAnchor: a real in-page link that works without JavaScript; the handler only skips the router hash visit. */}
        <a
          href="#site-content"
          onClick={skipToContent}
          data-theme-region="skip-link"
          className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-lg focus:border focus:border-border focus:bg-background focus:px-4 focus:font-medium focus:text-foreground focus:text-sm focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {t('skipToContent')}
        </a>
        <SiteReaderContext.Provider value={readerContext}>
          <SiteChatReaderLayout
            chat={{
              projectId,
              available: site?.capabilities?.answer === true,
              // The server sends null unless it really keeps question text.
              questionRetentionDays: site?.capabilities?.questionRetentionDays,
              lang: activeLanguage?.code,
              defaultLanguage,
              direction: isRtl ? 'rtl' : 'ltr',
              version: activeVersionPrefix,
              config,
              ask,
            }}
            banner={<SiteBanner projectId={projectId} banner={config?.banner} lang={activeLanguage?.code} nonce={router.options.ssr?.nonce} />}
            header={
              // Header block (main row + optional tab row) sticks as one unit.
              <div
                ref={observeHeader}
                className="sticky top-0 z-30 border-border/70 border-b bg-background/80 backdrop-blur-md"
                data-theme-region="header-shell"
              >
                {/* One row at every width: phones get [menu] [logo] … [search] [theme]; the
                  language and version switchers move into the drawer below `sm`. */}
                <header className="mx-auto flex h-16 max-w-[90rem] flex-nowrap items-center gap-1 px-4 sm:gap-3 sm:px-6" data-theme-region="header">
                  <MobileNav
                    nodes={site?.nav ?? []}
                    projectId={projectId}
                    currentPath={effectiveCurrentPath}
                    lang={navigationLanguage}
                    version={activeVersionPrefix}
                    label={t('menu')}
                    triggerLabel={t('openMenu')}
                    navLabel={t('docsPages')}
                    choices={mobileChoices}
                    closeLabel={deploy_close(undefined, { locale: resolveLocale(activeLanguage?.code) ?? 'en' })}
                    toggleLabel={t('toggleSubpages')}
                    isRtl={isRtl}
                    links={headerLinks}
                    anchors={navAnchors.map((anchor) => ({
                      label: anchor.label,
                      href: resolveNavHref(anchor.href),
                      active: !anchor.external && isNavActive(anchor.href),
                      external: Boolean(anchor.external),
                    }))}
                    cta={ctaLabel && ctaUrl ? { label: ctaLabel, href: resolveNavHref(ctaUrl) } : undefined}
                  />
                  {logoHref ? (
                    <a
                      href={logoHref}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 font-semibold tracking-tight sm:flex-initial"
                    >
                      {brandInner}
                    </a>
                  ) : (
                    <a href={sitePath()} className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 font-semibold tracking-tight sm:flex-initial">
                      {brandInner}
                    </a>
                  )}

                  {/* Centered search (Mintlify-style); collapses to an icon on phones. */}
                  <div className="hidden min-w-0 flex-1 justify-center px-2 sm:flex">
                    {showSearch ? (
                      <button
                        className="hidden h-9 w-full max-w-md cursor-pointer items-center gap-2.5 rounded-full border border-border/80 bg-muted/50 px-4 text-muted-foreground text-sm transition-colors hover:border-foreground/25 hover:bg-muted pointer-coarse:h-11 sm:flex"
                        onClick={() => openSiteSearch(() => setSearchOpen(true), t('searchDocumentation'))}
                        onFocus={preloadSiteSearch}
                        onPointerEnter={preloadSiteSearch}
                        onPointerDown={preloadSiteSearch}
                        onTouchStart={preloadSiteSearch}
                        aria-keyshortcuts={searchHotkey === 'slash' ? '/' : 'Control+K Meta+K'}
                        data-theme-region="search-trigger"
                        type="button"
                      >
                        <Search className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{config?.search?.placeholder ?? t('searchPlaceholder')}</span>
                        {/* Keyboard shortcuts read left-to-right even inside an RTL header. */}
                        <kbd
                          className="ms-auto hidden shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] md:inline-flex"
                          dir="ltr"
                          aria-hidden
                        >
                          {searchHotkey === 'slash' ? '/' : searchShortcut}
                        </kbd>
                      </button>
                    ) : null}
                  </div>

                  {showSearch ? (
                    <button
                      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
                      onClick={() => openSiteSearch(() => setSearchOpen(true), t('searchDocumentation'))}
                      onFocus={preloadSiteSearch}
                      onPointerEnter={preloadSiteSearch}
                      onPointerDown={preloadSiteSearch}
                      onTouchStart={preloadSiteSearch}
                      type="button"
                      aria-label={t('searchDocumentation')}
                    >
                      <Search className="size-5" aria-hidden />
                    </button>
                  ) : null}

                  {headerLinks.length > 0 ? (
                    <nav className="hidden shrink-0 items-center gap-5 text-sm lg:flex" aria-label={t('siteLinks')}>
                      {headerLinks.map((link) => (
                        <a
                          key={`${link.label}-${link.href}`}
                          href={link.href}
                          target={link.external ? '_blank' : undefined}
                          rel={link.external ? 'noreferrer' : undefined}
                          aria-current={link.active ? 'page' : undefined}
                          className={cn(
                            'inline-flex items-center gap-1 transition-colors',
                            link.active ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {link.label}
                          {link.external ? <ExternalLink className="size-3" aria-hidden /> : null}
                        </a>
                      ))}
                    </nav>
                  ) : null}

                  <div className="ms-auto flex shrink-0 items-center justify-end gap-1 sm:gap-1.5">
                    <div className="hidden items-center gap-1.5 sm:flex">
                      <LanguageSwitcher languages={languages} activeCode={activeLanguage?.code ?? ''} onChange={changeLanguage} />
                      <VersionSwitcher versions={versions} activeSlug={activeVersion} onChange={changeVersion} lang={activeLanguage?.code} />
                    </div>
                    <button
                      // 44px on phones and touch screens; the compact 36px only for a mouse or trackpad.
                      className="-me-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:me-0 sm:pointer-fine:size-9"
                      onClick={toggleSiteTheme}
                      type="button"
                      aria-label={t('darkMode')}
                      aria-pressed={siteTheme === 'dark'}
                    >
                      {siteTheme === 'dark' ? <Sun className="size-5 sm:size-4" aria-hidden /> : <Moon className="size-5 sm:size-4" aria-hidden />}
                    </button>
                    {ctaLabel && ctaUrl ? (
                      <a
                        href={resolveNavHref(ctaUrl)}
                        data-analytics-cta
                        data-analytics-placement="navbar"
                        target="_blank"
                        rel="noreferrer"
                        className="ms-1 hidden h-9 cursor-pointer items-center rounded-full bg-primary px-4 font-medium text-primary-foreground text-sm shadow-sm transition-opacity hover:opacity-90 sm:inline-flex"
                      >
                        {ctaLabel}
                      </a>
                    ) : null}
                  </div>
                </header>

                {navTabs.length > 0 ? (
                  <nav
                    className="mx-auto flex h-11 max-w-[90rem] items-center gap-1 overflow-x-auto px-4 sm:px-6"
                    data-theme-region="tabs"
                    aria-label={t('docsSections')}
                  >
                    {navTabs.map((tab) => {
                      const active = !tab.external && isNavActive(tab.href);
                      return (
                        <a
                          key={`${tab.label}-${tab.href}`}
                          href={resolveNavHref(tab.href)}
                          target={tab.external ? '_blank' : undefined}
                          rel={tab.external ? 'noreferrer' : undefined}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'relative inline-flex h-full shrink-0 items-center px-3 text-sm transition-colors',
                            active
                              ? 'font-medium text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {tab.label}
                        </a>
                      );
                    })}
                  </nav>
                ) : null}
              </div>
            }
            navigation={
              <>
                {navAnchors.length > 0 ? (
                  <ul className="mb-4 space-y-1 border-border/60 border-b pb-5">
                    {navAnchors.map((anchor) => (
                      <li key={`${anchor.label}-${anchor.href}`}>
                        <a
                          href={resolveNavHref(anchor.href)}
                          target={anchor.external ? '_blank' : undefined}
                          rel={anchor.external ? 'noreferrer' : undefined}
                          className="group flex items-center gap-3 rounded-lg px-2 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
                        >
                          <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-card shadow-2xs transition-colors group-hover:border-primary/40 group-hover:text-primary">
                            {hasIcon(anchor.icon) ? <PageIcon name={anchor.icon} className="size-3.5" /> : <Link2 className="size-3.5" />}
                          </span>
                          <span className="truncate">{anchor.label}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <SiteNav
                  nodes={site.nav ?? []}
                  projectId={projectId}
                  currentPath={effectiveCurrentPath}
                  lang={navigationLanguage}
                  version={activeVersionPrefix}
                  toggleLabel={t('toggleSubpages')}
                  label={t('docsPages')}
                />
              </>
            }
            content={
              // Skip-link target; focusable by script only, without a focus ring on click.
              <main id="site-content" tabIndex={-1} className="min-w-0 outline-none">
                <SitePageAlternatesContext.Provider value={pageAlternatesContext}>
                  <Outlet />
                </SitePageAlternatesContext.Provider>
              </main>
            }
            footer={
              hasFooterContent || showBadge || site.signedIn ? (
                <footer className="mt-auto border-border/60 border-t">
                  {hasFooterContent && footer ? (
                    <div
                      className="mx-auto flex max-w-[90rem] flex-col items-center justify-between gap-4 px-6 py-8 text-muted-foreground text-sm sm:flex-row"
                      data-theme-region="footer"
                    >
                      <span>{footer.copyright ?? `© ${new Date().getFullYear()} ${siteName ?? ''}`.trim()}</span>
                      <div className="flex items-center gap-1">
                        {footer.github ? (
                          <a
                            href={footer.github}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="GitHub"
                            className="cursor-pointer rounded-md p-2 transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <GithubIcon className="size-4" />
                          </a>
                        ) : null}
                        {footer.x ? (
                          <a
                            href={footer.x}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="X"
                            className="cursor-pointer rounded-md p-2 transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <XIcon className="size-4" />
                          </a>
                        ) : null}
                        {footer.linkedin ? (
                          <a
                            href={footer.linkedin}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="LinkedIn"
                            className="cursor-pointer rounded-md p-2 transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <LinkedinIcon className="size-4" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {showBadge ? (
                    <div className={cn('mx-auto max-w-[90rem] px-6', hasFooterContent ? 'pb-6' : 'py-5')}>
                      <MadeWithBadge lang={activeLanguage?.code} />
                    </div>
                  ) : null}
                  {/* Signed in on the site itself (a reader, or a team member on a custom domain). */}
                  {site.signedIn ? <SiteSignOut lang={activeLanguage?.code} projectId={projectId} /> : null}
                </footer>
              ) : null
            }
            overlays={
              <>
                {showSearch ? (
                  <ChatSearchBridge>
                    {(onAskAi) => (
                      <SiteSearch
                        onAskAi={onAskAi}
                        projectId={projectId}
                        open={searchOpen}
                        onOpenChange={setSearchOpen}
                        lang={activeLanguage?.code}
                        defaultLanguage={defaultLanguage}
                        direction={isRtl ? 'rtl' : 'ltr'}
                        version={activeVersionPrefix}
                        placeholder={config?.search?.placeholder}
                        hotkey={searchHotkey}
                        maxResults={config?.search?.maxResults}
                        versions={versions}
                        versionFilterEnabled={config?.search?.versionFilterEnabled !== false}
                        languages={languages}
                        filtersEnabled={config?.search?.filtersEnabled !== false}
                        suggestions={searchSuggestions}
                      />
                    )}
                  </ChatSearchBridge>
                ) : null}
                <SiteAnalyticsConsent projectId={projectId} config={config} lang={activeLanguage?.code} />
              </>
            }
          />
        </SiteReaderContext.Provider>
      </DocumentationThemeProvider>
    </SiteAnalyticsProvider>
  );
}
