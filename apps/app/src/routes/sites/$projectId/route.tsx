import { cn } from '@midad/design-system/lib/utils';
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { BookOpen, Check, CircleAlert, ExternalLink, Moon, PencilLine, Search, Sun, ThumbsDown, ThumbsUp } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { LanguageSwitcher } from '@/components/site/language-switcher';
import { MobileNav } from '@/components/site/mobile-nav';
import { type SiteLanguageAlternate, SitePageAlternatesContext } from '@/components/site/page-alternates-context';
import { PageIcon } from '@/components/site/page-icon';
import { SiteAnalyticsConsent } from '@/components/site/site-analytics-consent';
import { SiteBanner } from '@/components/site/site-banner';
import { firstLeafPath, SiteNav } from '@/components/site/site-nav';
import { SiteSearch } from '@/components/site/site-search';
import { VersionSwitcher } from '@/components/site/version-switcher';
import { useSite } from '@/hooks/api';
import { getData } from '@/hooks/api/client-helpers';
import type { ProjectConfig, SiteShell } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { siteT } from '@/lib/site-i18n';
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
  // initial HTML; the result also feeds site-level SEO tags via head().
  loader: async ({ params, deps }) => {
    try {
      const site = await getData<SiteShell>(
        await api.public.sites[':id'].$get({
          param: { id: params.projectId },
          query: deps.lang ? { lang: deps.lang } : {},
        }),
        'site',
      );
      return { site };
    } catch {
      return { site: null };
    }
  },
  head: ({ loaderData }) => siteHead(loaderData?.site ?? null),
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

const readerSessionId = (): string => {
  if (typeof window === 'undefined') {
    return 'ssr';
  }
  const key = 'midad.sid';
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2);
    window.localStorage.setItem(key, id);
  }
  return id;
};

const applyUrlTemplate = (template: string | undefined, path: string, fallbackUrl: string): string | null => {
  const trimmed = template?.trim();
  if (!trimmed) {
    return null;
  }
  const pagePath = path.replace(/^\/+/, '');
  return trimmed
    .replaceAll('{path}', pagePath)
    .replaceAll('{encodedPath}', encodeURIComponent(pagePath))
    .replaceAll('{url}', encodeURIComponent(fallbackUrl));
};

function ReaderActions({
  projectId,
  path,
  language,
  addons,
}: {
  projectId: string;
  path: string;
  language?: string;
  addons: NonNullable<ProjectConfig['addons']> | undefined;
}) {
  const t = siteT(language);
  const [sentiment, setSentiment] = useState<'helpful' | 'not_helpful' | null>(null);
  const [pageUrl, setPageUrl] = useState(() => `/sites/${projectId}/${path}`);
  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);
  const editUrl = addons?.editSuggestions !== false ? applyUrlTemplate(addons?.editUrl, path, pageUrl) : null;
  const issueUrl = addons?.issueLinks !== false ? applyUrlTemplate(addons?.issueUrl, path, pageUrl) : null;
  const showFeedback = addons?.feedback !== false;

  if (!showFeedback && !editUrl && !issueUrl) {
    return null;
  }

  const sendFeedback = (query: 'helpful' | 'not_helpful') => {
    setSentiment(query);
    api.public.sites[':id'].events
      .$post({
        param: { id: projectId },
        json: {
          type: 'feedback',
          path,
          query,
          sessionId: readerSessionId(),
          referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
          language,
        },
      })
      .catch(() => undefined);
  };

  return (
    <div className="mx-auto max-w-4xl px-8 pb-10">
      <div className="flex flex-col gap-4 border-border border-t pt-5 text-sm sm:flex-row sm:items-center sm:justify-between">
        {showFeedback ? (
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            {sentiment ? (
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <Check className="size-4 text-primary" /> {t('feedbackThanks')}
              </span>
            ) : (
              <>
                <span>{t('feedbackQuestion')}</span>
                <button
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-foreground hover:bg-muted"
                  onClick={() => sendFeedback('helpful')}
                  type="button"
                >
                  <ThumbsUp className="size-3.5" /> {t('feedbackYes')}
                </button>
                <button
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-foreground hover:bg-muted"
                  onClick={() => sendFeedback('not_helpful')}
                  type="button"
                >
                  <ThumbsDown className="size-3.5" /> {t('feedbackNo')}
                </button>
              </>
            )}
          </div>
        ) : (
          <div />
        )}

        {editUrl || issueUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            {editUrl ? (
              <a
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                href={editUrl}
                rel="noreferrer"
                target="_blank"
              >
                <PencilLine className="size-3.5" /> {t('editPage')}
              </a>
            ) : null}
            {issueUrl ? (
              <a
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                href={issueUrl}
                rel="noreferrer"
                target="_blank"
              >
                <CircleAlert className="size-3.5" /> {t('raiseIssue')}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SiteChrome() {
  const { projectId } = Route.useParams();
  const { lang } = Route.useSearch();
  const { site: initialSite } = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const [searchOpen, setSearchOpen] = useState(false);
  const [pageAlternates, setPageAlternates] = useState<SiteLanguageAlternate[]>([]);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentPath = decodeURIComponent(pathname.replace(new RegExp(`^/sites/${projectId}/?`), '')).replace(/\/+$/, '');
  const versionCandidate = currentPath && currentPath !== 'changelog' ? currentPath.split('/')[0] : undefined;
  // Seed from the server loader so the nav + branding render in the initial HTML.
  const { data: site, isPending, isError } = useSite(projectId, lang, initialSite ?? undefined, versionCandidate);
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

  // Config is a free-form JSON blob server-side; treat every field as optional.
  const config = (site?.project.config ?? null) as unknown as ProjectConfig | null;
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
    const storageKey = `midad.site.theme.${projectId}`;
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
        window.localStorage.setItem(`midad.site.theme.${projectId}`, next);
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

  // Apply the project's favicon on the published site.
  const faviconUrl = site?.project.faviconUrl;
  useEffect(() => {
    if (typeof document === 'undefined' || !faviconUrl) {
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

  if (isError) {
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

  const accent = config?.styling?.primaryColor ?? site?.project.color ?? '#5546e8';
  // Search is on by default; only an explicit `false` hides it (legacy configs
  // that never set the field keep search).
  const showSearch = config?.navbar?.showSearch !== false;
  const searchHotkey = config?.search?.hotkey;
  const navLinks = config?.navbar?.links ?? [];
  const navTabs = config?.navbar?.tabs ?? [];
  const navAnchors = config?.navbar?.anchors ?? [];
  const ctaLabel = config?.navbar?.ctaLabel;
  const ctaUrl = config?.navbar?.ctaUrl;
  const footer = config?.footer;
  const addons = config?.addons;

  // Branding: a theme-specific logo (config.branding) overrides the legacy
  // top-level logoUrl, and an optional logoHref points the brand off-site.
  const branding = config?.branding;
  const logoSrc = (siteTheme === 'dark' ? branding?.logoDark || branding?.logoLight : branding?.logoLight) || site?.project.logoUrl || null;
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
  const chromeStyle = { '--primary': accent, '--ring': accent } as Record<string, string | number>;
  if (radiusValue) {
    chromeStyle['--radius'] = radiusValue;
  }
  if (bodyFont) {
    chromeStyle.fontFamily = `'${bodyFont}', var(--font-sans, system-ui, sans-serif)`;
  }
  if (baseSize) {
    chromeStyle.fontSize = `${baseSize}px`;
  }
  const fontCss = [
    headingFont ? `.midad-site-chrome :is(h1,h2,h3,h4,h5,h6){font-family:'${headingFont}',var(--font-sans,sans-serif)}` : '',
    codeFont ? `.midad-site-chrome :is(code,pre,kbd){font-family:'${codeFont}',var(--font-mono,monospace)}` : '',
  ]
    .filter(Boolean)
    .join('');
  const brandInner = (
    <>
      {logoSrc ? (
        <img src={logoSrc} alt={site?.project.name ?? 'Logo'} className="h-7 w-auto object-contain" />
      ) : (
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">{site?.project.name?.[0] ?? 'D'}</span>
      )}
      {site?.project.name ?? 'Documentation'}
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

  return (
    // `dir` flips the whole document tree for RTL languages; code blocks are
    // forced back to LTR via the scoped rule below.
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={cn('midad-site-chrome min-h-screen bg-background [&_code]:[direction:ltr] [&_pre]:[direction:ltr]', siteTheme === 'dark' && 'dark')}
      style={chromeStyle as CSSProperties}
    >
      {fontCss ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: scoped font rules; font names are charset-guarded above.
        <style dangerouslySetInnerHTML={{ __html: fontCss }} />
      ) : null}
      <SiteBanner projectId={projectId} banner={config?.banner} />

      <header className="sticky top-0 z-30 border-border border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-6">
          <MobileNav
            nodes={site?.nav ?? []}
            projectId={projectId}
            currentPath={effectiveCurrentPath}
            lang={lang}
            version={activeVersionPrefix}
            label={t('docs')}
            isRtl={isRtl}
          />
          {logoHref ? (
            <a href={logoHref} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-semibold tracking-tight">
              {brandInner}
            </a>
          ) : (
            <a href={sitePath()} className="flex items-center gap-2 font-semibold tracking-tight">
              {brandInner}
            </a>
          )}
          <nav className="ms-4 hidden items-center gap-5 text-muted-foreground text-sm sm:flex">
            <a href={sitePath()} className={`transition-colors hover:text-foreground ${isChangelog ? '' : 'font-medium text-foreground'}`}>
              {t('docs')}
            </a>
            <a
              href={siteHref(projectId, 'changelog', { lang })}
              className={`transition-colors hover:text-foreground ${isChangelog ? 'font-medium text-foreground' : ''}`}
            >
              {t('changelog')}
            </a>
            {navLinks.map((link) => (
              <a
                key={`${link.label}-${link.href}`}
                href={link.href}
                target={link.external ? '_blank' : undefined}
                rel={link.external ? 'noreferrer' : undefined}
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                {link.label}
                {link.external ? <ExternalLink className="size-3" /> : null}
              </a>
            ))}
          </nav>
          {showSearch ? (
            <button
              className="ms-auto flex h-9 w-64 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground text-sm"
              onClick={() => setSearchOpen(true)}
              type="button"
            >
              <Search className="size-3.5" />
              <span className="flex-1 text-start">{config?.search?.placeholder ?? t('search')}</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{searchHotkey === 'slash' ? '/' : '⌘K'}</kbd>
            </button>
          ) : (
            // A zero-width flex spacer keeps the trailing controls right-aligned
            // when the search field is hidden (it carried the `ms-auto`).
            <div className="ms-auto" />
          )}
          <LanguageSwitcher languages={languages} activeCode={activeLanguage?.code ?? ''} onChange={changeLanguage} />
          <VersionSwitcher versions={versions} activeSlug={activeVersion} onChange={changeVersion} />
          <button
            className="cursor-pointer rounded-md p-2 text-muted-foreground hover:bg-muted"
            onClick={toggleSiteTheme}
            type="button"
            aria-label="Toggle theme"
          >
            {siteTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          {ctaLabel && ctaUrl ? (
            <a
              href={ctaUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden cursor-pointer items-center rounded-lg bg-primary px-3.5 py-2 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90 sm:inline-flex"
            >
              {ctaLabel}
            </a>
          ) : null}
        </div>
      </header>

      {navTabs.length > 0 ? (
        <div className="border-border border-b bg-background">
          <div className="mx-auto flex h-11 max-w-[1400px] items-center gap-1 overflow-x-auto px-6">
            {navTabs.map((tab) => {
              const prefix = tab.href.replace(/^\/+/, '').replace(/\/+$/, '');
              const active = !tab.external && prefix !== '' && (effectiveCurrentPath === prefix || effectiveCurrentPath.startsWith(`${prefix}/`));
              return (
                <a
                  key={`${tab.label}-${tab.href}`}
                  href={tab.href}
                  target={tab.external ? '_blank' : undefined}
                  rel={tab.external ? 'noreferrer' : undefined}
                  className={cn(
                    'inline-flex h-full shrink-0 items-center border-b-2 px-3 text-sm transition-colors',
                    active ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </a>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mx-auto grid max-w-[1400px] grid-cols-1 lg:grid-cols-[260px_1fr]">
        <aside className="hidden border-border border-e lg:block">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-4">
            {navAnchors.length > 0 ? (
              <ul className="space-y-0.5 border-border border-b py-4">
                {navAnchors.map((anchor) => (
                  <li key={`${anchor.label}-${anchor.href}`}>
                    <a
                      href={anchor.href}
                      target={anchor.external ? '_blank' : undefined}
                      rel={anchor.external ? 'noreferrer' : undefined}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-foreground/75 text-sm transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <PageIcon name={anchor.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{anchor.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {isPending ? (
              <div className="py-6 text-muted-foreground text-sm">{t('loading')}</div>
            ) : (
              <SiteNav nodes={site?.nav ?? []} projectId={projectId} currentPath={effectiveCurrentPath} lang={lang} version={activeVersionPrefix} />
            )}
          </div>
        </aside>
        <main className="min-w-0">
          <SitePageAlternatesContext.Provider value={pageAlternatesContext}>
            <Outlet />
          </SitePageAlternatesContext.Provider>
          {!isChangelog ? <ReaderActions projectId={projectId} path={effectiveCurrentPath} language={activeLanguage?.code} addons={addons} /> : null}
        </main>
      </div>

      {footer && (footer.copyright || footer.github || footer.x || footer.linkedin) ? (
        <footer className="border-border border-t bg-card">
          <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-4 px-6 py-8 text-muted-foreground text-sm sm:flex-row">
            <span>{footer.copyright ?? `© ${new Date().getFullYear()} ${site?.project.name ?? ''}`.trim()}</span>
            <div className="flex items-center gap-3">
              {footer.github ? (
                <a
                  href={footer.github}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub"
                  className="cursor-pointer rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground"
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
                  className="cursor-pointer rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground"
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
                  className="cursor-pointer rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground"
                >
                  <LinkedinIcon className="size-4" />
                </a>
              ) : null}
            </div>
          </div>
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
