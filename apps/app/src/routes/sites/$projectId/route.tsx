import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { cn } from '@nibleaf/design-system/lib/utils';
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { BookOpen, ExternalLink, Link2, Moon, Search, Sun } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { LanguageSwitcher } from '@/components/site/language-switcher';
import { MadeWithBadge } from '@/components/site/made-with-badge';
import { MobileNav } from '@/components/site/mobile-nav';
import { type SiteLanguageAlternate, SitePageAlternatesContext } from '@/components/site/page-alternates-context';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { SiteAnalyticsConsent } from '@/components/site/site-analytics-consent';
import { SiteBanner } from '@/components/site/site-banner';
import { firstLeafPath, SiteNav } from '@/components/site/site-nav';
import { SiteSearch } from '@/components/site/site-search';
import { VersionSwitcher } from '@/components/site/version-switcher';
import { getData } from '@/hooks/api/client-helpers';
import type { ProjectConfig, SiteShell } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { publishedSiteLogo } from '@/lib/site-branding';
import { siteT } from '@/lib/site-i18n';
import { customDomainOrigin } from '@/lib/site-origin';
import { siteHref } from '@/lib/site-paths';
import { siteHead } from '@/lib/site-seo';

export const Route = createFileRoute('/sites/$projectId')({
  component: SiteChrome,
  // The active language lives in the URL so it survives reloads and is shareable.
  validateSearch: (search: Record<string, unknown>): { lang?: string } => ({
    lang: typeof search.lang === 'string' && search.lang ? search.lang : undefined,
  }),
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // Fetch the site shell on the server so the chrome (nav, branding) is in the
  // initial HTML; the result also feeds site-level SEO tags via head(). The
  // first path segment is passed as a version candidate so versioned URLs
  // (`/sites/:id/v2/...`) SSR with that version's nav — the server ignores
  // candidates that aren't real version slugs.
  loader: async ({ params, deps, location }) => {
    try {
      const rest = location.pathname.replace(new RegExp(`^/sites/${params.projectId}/?`), '').replace(/\/+$/, '');
      const candidate = rest && rest !== 'changelog' ? decodeURIComponent(rest).split('/')[0] : undefined;
      const site = await getData<SiteShell>(
        await api.public.sites[':id'].$get({
          param: { id: params.projectId },
          query: { ...(deps.lang ? { lang: deps.lang } : {}), ...(candidate ? { version: candidate } : {}) },
        }),
        'site',
      );
      return { site, siteOrigin: customDomainOrigin() };
    } catch {
      return { site: null, siteOrigin: customDomainOrigin() };
    }
  },
  head: ({ loaderData }) => siteHead(loaderData?.site ?? null, loaderData?.siteOrigin),
});

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
  const { lang } = Route.useSearch();
  const { site } = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const [searchOpen, setSearchOpen] = useState(false);
  const [pageAlternates, setPageAlternates] = useState<SiteLanguageAlternate[]>([]);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentPath = decodeURIComponent(pathname.replace(new RegExp(`^/sites/${projectId}/?`), '')).replace(/\/+$/, '');
  const isChangelog = currentPath === 'changelog';
  const currentVersion = site?.versions.find((item) => item.slug === site.activeVersion) ?? site?.versions.find((item) => item.isDefault);
  const activeVersionPrefix = currentVersion && !currentVersion.isDefault ? currentVersion.slug : undefined;
  const contentPath =
    activeVersionPrefix && (currentPath === activeVersionPrefix || currentPath.startsWith(`${activeVersionPrefix}/`))
      ? currentPath.slice(activeVersionPrefix.length).replace(/^\/+/, '')
      : currentPath;
  // The home route (empty path) renders the site's first page server-side, so
  // highlight that page's nav entry rather than leaving the sidebar inert.
  const effectiveCurrentPath = contentPath || firstLeafPath(site?.nav ?? []) || '';

  const config: ProjectConfig | null = site?.project.config ?? null;
  const languages = site?.languages ?? [];
  const versions = site?.versions ?? [];
  // Resolve the active language: URL param → server-reported active → default → first.
  const activeLanguage = useMemo(() => {
    const code = lang ?? site?.activeLanguage;
    return languages.find((language) => language.code === code) ?? languages.find((language) => language.isDefault) ?? languages[0];
  }, [languages, lang, site?.activeLanguage]);
  const isRtl = activeLanguage?.direction === 'RTL';
  // Chrome strings follow the active language so an Arabic site reads Arabic.
  const t = siteT(activeLanguage?.code);

  // The published site manages its OWN light/dark theme (a class on the chrome
  // below), independent of the dashboard's theme — so the site's config default
  // and a visitor's toggle never clobber the editor/dashboard theme.
  const configTheme = config?.styling?.theme; // 'light' | 'dark' | 'system' | undefined
  const [siteTheme, setSiteTheme] = useState<'light' | 'dark'>(configTheme === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storageKey = `nibleaf.site.theme.${projectId}`;
    const stored = window.localStorage.getItem(storageKey);
    // An explicit visitor choice always wins over the configured default.
    if (stored === 'dark' || stored === 'light') {
      setSiteTheme(stored);
      return;
    }
    // 'system' follows the visitor's OS preference, and keeps following it live
    // until the visitor toggles (which stores an explicit choice the guard below
    // then respects). 'light'/'dark' apply the configured default directly.
    if (configTheme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setSiteTheme(mq.matches ? 'dark' : 'light');
      const onChange = (e: MediaQueryListEvent) => {
        if (window.localStorage.getItem(storageKey)) {
          return;
        }
        setSiteTheme(e.matches ? 'dark' : 'light');
      };
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    setSiteTheme(configTheme === 'dark' ? 'dark' : 'light');
  }, [projectId, configTheme]);
  const toggleSiteTheme = () => {
    setSiteTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(`nibleaf.site.theme.${projectId}`, next);
      } catch (_) {
        // ignore (private mode etc.)
      }
      return next;
    });
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
    const dashboardWasDark = root.classList.contains('dark');
    return () => {
      root.classList.toggle('dark', dashboardWasDark);
    };
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.classList.toggle('dark', siteTheme === 'dark');
  }, [siteTheme]);

  // Apply the configured favicon on the published site.
  const faviconUrl = config?.branding?.favicon || '/favicon.svg';
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }, [faviconUrl]);

  // (The document <html lang/dir> is set server-side in __root's RootDocument
  // from this route's resolved language, so crawlers + first paint are correct.)
  // (The changelog route now owns its own SSR <title>/description/canonical via
  // its head(), so there's no client-side title patching here.)

  const pageAlternatesContext = useMemo(() => ({ alternates: pageAlternates, setAlternates: setPageAlternates }), [pageAlternates]);

  if (!site) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div>
          <BookOpen className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-4 font-semibold text-2xl tracking-tight">{t('notPublishedTitle')}</h1>
          <p className="mt-2 max-w-sm text-muted-foreground text-sm">{t('notPublishedBody')}</p>
        </div>
      </div>
    );
  }

  const accent = config?.styling?.primaryColor ?? '#5546e8';
  // Search is on by default; only an explicit `false` hides it.
  const showSearch = config?.navbar?.showSearch !== false;
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

  // Apply the configured corner radius + typography. Font names are charset-guarded
  // before being interpolated into the scoped <style> below (defense-in-depth).
  const safeFont = (font?: string): string | undefined => {
    const trimmed = font?.trim();
    return trimmed && /^[A-Za-z0-9 ]+$/.test(trimmed) ? trimmed : undefined;
  };
  const headingFont = safeFont(config?.typography?.headingFont);
  const bodyFont = safeFont(config?.typography?.bodyFont);
  const codeFont = safeFont(config?.typography?.codeFont);
  const baseSize = config?.typography?.baseSize;
  const radius = config?.styling?.radius;
  const radiusValue = radius === 'sharp' ? '0px' : radius === 'pill' ? '1rem' : radius === 'rounded' ? '0.5rem' : undefined;
  // --site-header-h drives every sticky offset (sidebar, TOC, heading scroll
  // margins) so they stay correct whether or not the tab row renders.
  const headerHeight = navTabs.length > 0 ? '6.75rem' : '4rem';
  const chromeStyle = {
    '--site-header-h': headerHeight,
    '--content-scroll-mt': `calc(${headerHeight} + 1.5rem)`,
  } as Record<string, string | number>;
  if (bodyFont) {
    chromeStyle.fontFamily = `'${bodyFont}', var(--font-sans, system-ui, sans-serif)`;
  }
  if (baseSize) {
    chromeStyle.fontSize = `${baseSize}px`;
  }
  // Reading rhythm (typeset.css): line height + block spacing for rendered doc
  // content. Base size cascades via em (--typeset-size defaults to 1em), so
  // only these two need explicit wiring. Values come from the enum-validated
  // config, never free text.
  const leading = config?.typography?.leading;
  const flow = config?.typography?.flow;
  if (leading) {
    chromeStyle['--typeset-leading'] = leading;
  }
  if (flow) {
    chromeStyle['--typeset-flow'] = `${flow}em`;
  }
  // Accent/radius tokens are set on :root (not the chrome wrapper) so portaled
  // surfaces — the mobile drawer, search dialog, dropdown menus — pick them up
  // too. The site route owns the whole document while mounted, and the <style>
  // element unmounts with it, restoring the dashboard tokens. In dark mode the
  // configured accent is lightness-lifted via color-mix so accent-colored text
  // keeps AA contrast on the dark background (falls back to the raw accent on
  // engines without color-mix, which matches the old behavior).
  const safeAccent = /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : '#5546e8';
  const darkAccent = `color-mix(in oklab,${safeAccent} 72%,white)`;
  const themeCss = [
    `:root{--primary:${safeAccent};--ring:${safeAccent};${radiusValue ? `--radius:${radiusValue};` : ''}}`,
    // Two dark selectors: :root.dark covers portaled surfaces (which inherit
    // from <html>), while .nibleaf-site-chrome.dark out-specifies the design
    // system's `.dark` token rule that matches the wrapper's own dark class.
    `:root.dark,.nibleaf-site-chrome.dark{--primary:${darkAccent};--ring:${darkAccent}}`,
    headingFont ? `.nibleaf-site-chrome :is(h1,h2,h3,h4,h5,h6){font-family:'${headingFont}',var(--font-sans,sans-serif)}` : '',
    codeFont ? `.nibleaf-site-chrome :is(code,pre,kbd){font-family:'${codeFont}',var(--font-mono,monospace)}` : '',
  ]
    .filter(Boolean)
    .join('');
  // The active language may localize the site name (brand + footer copyright).
  const siteName = site?.languageConfig?.name || site?.project.name;
  const brandInner = (
    <>
      {logo ? (
        <>
          <img src={logo.src} alt={siteName ?? 'Logo'} className={cn('object-contain', logo.markOnly ? 'size-7' : 'h-6 w-auto')} />
          {logo.markOnly ? null : <span className="truncate">{siteName ?? 'Documentation'}</span>}
        </>
      ) : (
        <>
          <span className="grid size-7 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground text-sm">
            {siteName?.[0] ?? 'D'}
          </span>
          <span className="truncate">{siteName ?? 'Documentation'}</span>
        </>
      )}
    </>
  );

  const changeLanguage = (code: string) => {
    const alternate = pageAlternates.find((item) => item.code === code && item.path);
    if (!isChangelog && alternate?.path) {
      window.location.assign(siteHref(projectId, alternate.path, { lang: code, version: activeVersionPrefix }));
      return;
    }
    navigate({ search: (prev) => ({ ...prev, lang: code }) });
  };
  const changeVersion = (slug: string) => {
    const defaultVersion = versions.find((item) => item.isDefault);
    const targetPrefix = defaultVersion?.slug === slug ? '' : slug;
    const targetPath = [targetPrefix, isChangelog ? '' : contentPath].filter(Boolean).join('/');
    window.location.assign(siteHref(projectId, targetPath, { lang }));
  };
  const activeVersion = site?.activeVersion ?? versions.find((item) => item.isDefault)?.slug ?? '';
  const sitePath = (path = '') => siteHref(projectId, path, { lang, version: activeVersionPrefix });

  // Only configured navigation renders — the chrome imposes no IA of its own.
  // Root-relative hrefs are site-internal: resolve them to the site base (and
  // keep the active language/version) so `/guides`-style links work on both
  // path-based (/sites/:id) and custom-domain serving.
  const resolveNavHref = (href: string): string =>
    href.startsWith('/') && !href.startsWith('//') ? siteHref(projectId, href, { lang, version: activeVersionPrefix }) : href;
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
      ? [{ label: t('changelog'), href: siteHref(projectId, 'changelog', { lang }), active: isChangelog, external: false }]
      : []),
    ...navLinks.map((link) => ({
      label: link.label,
      href: resolveNavHref(link.href),
      active: !link.external && isNavActive(link.href),
      external: Boolean(link.external),
    })),
  ];

  return (
    // `dir` flips the whole document tree for RTL languages; code blocks are
    // forced back to LTR via the scoped rule below.
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={cn(
        'nibleaf-site-chrome flex min-h-screen flex-col bg-background [&_code]:[direction:ltr] [&_pre]:[direction:ltr]',
        siteTheme === 'dark' && 'dark',
      )}
      style={chromeStyle as CSSProperties}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: accent is regex-guarded hex, radius is enum-derived, font names are charset-guarded above. */}
      <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      <SiteBanner projectId={projectId} banner={config?.banner} lang={activeLanguage?.code} />

      {/* Header block (main row + optional tab row) sticks as one unit. */}
      <div className="sticky top-0 z-30 border-border/70 border-b bg-background/80 backdrop-blur-md">
        <header className="mx-auto flex h-16 max-w-[90rem] items-center gap-3 px-4 sm:px-6">
          <MobileNav
            nodes={site?.nav ?? []}
            projectId={projectId}
            currentPath={effectiveCurrentPath}
            lang={lang}
            version={activeVersionPrefix}
            label={t('docs')}
            isRtl={isRtl}
            links={headerLinks}
          />
          {logoHref ? (
            <a href={logoHref} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight">
              {brandInner}
            </a>
          ) : (
            <a href={sitePath()} className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight">
              {brandInner}
            </a>
          )}

          {/* Centered search (Mintlify-style); collapses to an icon on phones. */}
          <div className="flex min-w-0 flex-1 justify-center px-2">
            {showSearch ? (
              <button
                className="hidden h-9 w-full max-w-md cursor-pointer items-center gap-2.5 rounded-full border border-border/80 bg-muted/50 px-4 text-muted-foreground text-sm transition-colors hover:border-foreground/25 hover:bg-muted sm:flex"
                onClick={() => setSearchOpen(true)}
                type="button"
              >
                <Search className="size-3.5 shrink-0" />
                <span className="truncate">{config?.search?.placeholder ?? t('search')}</span>
                <kbd className="ms-auto hidden shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] md:inline-flex">
                  {searchHotkey === 'slash' ? '/' : '⌘K'}
                </kbd>
              </button>
            ) : null}
          </div>

          {showSearch ? (
            <button
              className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
              onClick={() => setSearchOpen(true)}
              type="button"
              aria-label={t('search')}
            >
              <Search className="size-4" />
            </button>
          ) : null}

          <nav className="hidden shrink-0 items-center gap-5 text-sm md:flex">
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
                {link.external ? <ExternalLink className="size-3" /> : null}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5">
            <LanguageSwitcher languages={languages} activeCode={activeLanguage?.code ?? ''} onChange={changeLanguage} />
            <VersionSwitcher versions={versions} activeSlug={activeVersion} onChange={changeVersion} lang={activeLanguage?.code} />
            <button
              className="grid size-9 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={toggleSiteTheme}
              type="button"
              aria-label={t('toggleTheme')}
            >
              {siteTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            {ctaLabel && ctaUrl ? (
              <a
                href={ctaUrl}
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
          <nav className="mx-auto flex h-11 max-w-[90rem] items-center gap-1 overflow-x-auto px-4 sm:px-6">
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

      <div className="mx-auto w-full max-w-[90rem] flex-1 px-4 sm:px-6 lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:gap-10">
        <aside className="sticky top-(--site-header-h) hidden h-[calc(100dvh-var(--site-header-h))] self-start border-border/60 border-e lg:block">
          {/* Base UI sets position:relative inline on its ScrollArea root. Keep
              sticky positioning on the outer aside so the entire navigation
              viewport remains visible while this inner viewport scrolls. */}
          <ScrollArea className="h-full">
            <div className="pt-7 pb-12 pe-5">
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
              <SiteNav nodes={site.nav ?? []} projectId={projectId} currentPath={effectiveCurrentPath} lang={lang} version={activeVersionPrefix} />
            </div>
          </ScrollArea>
        </aside>
        <main className="min-w-0">
          <SitePageAlternatesContext.Provider value={pageAlternatesContext}>
            <Outlet />
          </SitePageAlternatesContext.Provider>
        </main>
      </div>

      {hasFooterContent || showBadge ? (
        <footer className="mt-auto border-border/60 border-t">
          {hasFooterContent && footer ? (
            <div className="mx-auto flex max-w-[90rem] flex-col items-center justify-between gap-4 px-6 py-8 text-muted-foreground text-sm sm:flex-row">
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
        </footer>
      ) : null}

      {showSearch ? (
        <SiteSearch
          projectId={projectId}
          open={searchOpen}
          onOpenChange={setSearchOpen}
          lang={activeLanguage?.code}
          version={activeVersionPrefix}
          placeholder={config?.search?.placeholder}
          hotkey={searchHotkey}
          maxResults={config?.search?.maxResults}
        />
      ) : null}
      <SiteAnalyticsConsent projectId={projectId} config={config} lang={activeLanguage?.code} />
    </div>
  );
}
