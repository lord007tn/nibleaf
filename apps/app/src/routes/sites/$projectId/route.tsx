import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { BookOpen, ExternalLink, Moon, Search, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { LanguageSwitcher } from '@/components/site/language-switcher';
import { MobileNav } from '@/components/site/mobile-nav';
import { PageIcon } from '@/components/site/page-icon';
import { SiteBanner } from '@/components/site/site-banner';
import { firstLeafPath, SiteNav } from '@/components/site/site-nav';
import { SiteSearch } from '@/components/site/site-search';
import { useSite } from '@/hooks/api';
import { getData } from '@/hooks/api/client-helpers';
import type { ProjectConfig, SiteShell } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { siteT } from '@/lib/site-i18n';
import { siteHead } from '@/lib/site-seo';
import { cn } from '@/lib/utils';

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
        await api.public.sites[':id'].$get({ param: { id: params.projectId }, query: deps.lang ? { lang: deps.lang } : {} }),
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

function SiteChrome() {
  const { projectId } = Route.useParams();
  const { lang } = Route.useSearch();
  const { site: initialSite } = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  // Seed from the server loader so the nav + branding render in the initial HTML.
  const { data: site, isPending, isError } = useSite(projectId, lang, initialSite ?? undefined);
  const { setTheme, resolvedTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentPath = decodeURIComponent(pathname.replace(new RegExp(`^/sites/${projectId}/?`), '')).replace(/\/+$/, '');
  const isChangelog = currentPath === 'changelog';
  // The home route (empty path) renders the site's first page server-side, so
  // highlight that page's nav entry rather than leaving the sidebar inert.
  const effectiveCurrentPath = currentPath || firstLeafPath(site?.nav ?? []) || '';

  // Config is a free-form JSON blob server-side; treat every field as optional.
  const config = (site?.project.config ?? null) as unknown as ProjectConfig | null;
  const languages = site?.languages ?? [];
  // Resolve the active language: URL param → server-reported active → default → first.
  const activeLanguage = useMemo(() => {
    const code = lang ?? site?.activeLanguage;
    return languages.find((language) => language.code === code) ?? languages.find((language) => language.isDefault) ?? languages[0];
  }, [languages, lang, site?.activeLanguage]);
  const isRtl = activeLanguage?.direction === 'RTL';
  // Chrome strings follow the active language so an Arabic site reads Arabic.
  const t = siteT(activeLanguage?.code);

  // Seed the theme from config the first time a site with a theme preference loads.
  // Skipped for 'system' so next-themes keeps following the OS.
  const configTheme = config?.styling?.theme;
  useEffect(() => {
    if (configTheme === 'light' || configTheme === 'dark') {
      setTheme(configTheme);
    }
  }, [configTheme, setTheme]);

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

  // Site-level SEO fallback for routes without a SitePageView (e.g. changelog).
  // On doc pages, SitePageView owns the title and merges config itself, so we
  // skip here to avoid stomping the per-page title.
  useEffect(() => {
    if (typeof document === 'undefined' || !site || !isChangelog) {
      return;
    }
    const metaTitle = config?.seo?.metaTitle;
    document.title = metaTitle ? `Changelog — ${metaTitle}` : `Changelog — ${site.project.name}`;
    const description = config?.seo?.metaDescription ?? site.project.description ?? '';
    if (description) {
      let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (!tag) {
        tag = document.createElement('meta');
        tag.name = 'description';
        document.head.appendChild(tag);
      }
      tag.content = description;
    }
  }, [site, isChangelog, config?.seo?.metaTitle, config?.seo?.metaDescription]);

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
  const navLinks = config?.navbar?.links ?? [];
  const navTabs = config?.navbar?.tabs ?? [];
  const navAnchors = config?.navbar?.anchors ?? [];
  const ctaLabel = config?.navbar?.ctaLabel;
  const ctaUrl = config?.navbar?.ctaUrl;
  const footer = config?.footer;

  const changeLanguage = (code: string) => {
    navigate({ search: (prev) => ({ ...prev, lang: code }) });
  };

  return (
    // `dir` flips the whole document tree for RTL languages; code blocks are
    // forced back to LTR via the scoped rule below.
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="min-h-screen bg-background [&_pre]:[direction:ltr] [&_code]:[direction:ltr]"
      style={{ '--primary': accent, '--ring': accent } as CSSProperties}
    >
      <SiteBanner projectId={projectId} banner={config?.banner} />

      <header className="sticky top-0 z-30 border-border border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-6">
          <MobileNav nodes={site?.nav ?? []} projectId={projectId} currentPath={effectiveCurrentPath} lang={lang} label={t('docs')} />
          <Link to="/sites/$projectId" params={{ projectId }} search={{ lang }} className="flex items-center gap-2 font-semibold tracking-tight">
            {site?.project.logoUrl ? (
              <img src={site.project.logoUrl} alt={site.project.name ?? 'Logo'} className="h-7 w-auto object-contain" />
            ) : (
              <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">{site?.project.name?.[0] ?? 'D'}</span>
            )}
            {site?.project.name ?? 'Documentation'}
          </Link>
          <nav className="ms-4 hidden items-center gap-5 text-muted-foreground text-sm sm:flex">
            <Link
              to="/sites/$projectId"
              params={{ projectId }}
              search={{ lang }}
              className={`transition-colors hover:text-foreground ${isChangelog ? '' : 'font-medium text-foreground'}`}
            >
              {t('docs')}
            </Link>
            <Link
              to="/sites/$projectId/changelog"
              params={{ projectId }}
              search={{ lang }}
              className={`transition-colors hover:text-foreground ${isChangelog ? 'font-medium text-foreground' : ''}`}
            >
              {t('changelog')}
            </Link>
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
          <button
            className="ms-auto flex h-9 w-64 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground text-sm"
            onClick={() => setSearchOpen(true)}
            type="button"
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-start">{config?.search?.placeholder ?? t('search')}</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd>
          </button>
          <LanguageSwitcher languages={languages} activeCode={activeLanguage?.code ?? ''} onChange={changeLanguage} />
          <button
            className="cursor-pointer rounded-md p-2 text-muted-foreground hover:bg-muted"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            type="button"
            aria-label="Toggle theme"
          >
            {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
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
              <SiteNav nodes={site?.nav ?? []} projectId={projectId} currentPath={effectiveCurrentPath} lang={lang} />
            )}
          </div>
        </aside>
        <main className="min-w-0">
          <Outlet />
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

      <SiteSearch projectId={projectId} open={searchOpen} onOpenChange={setSearchOpen} lang={activeLanguage?.code} />
    </div>
  );
}
