import { Button, buttonVariants } from '@nibleaf/design-system/components/ui/button';
import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@nibleaf/design-system/components/ui/sheet';
import { getLocale, renderedLocale, subscribeLanguage } from '@nibleaf/i18n/locale-state';
import { isRtl, type Locale, resolveLocale } from '@nibleaf/i18n/locales';
import {
  gitpreview_close,
  gitpreview_empty,
  gitpreview_invalidbody,
  gitpreview_invalidtitle,
  gitpreview_language,
  gitpreview_openpages,
  gitpreview_pagesnav,
  gitpreview_retry,
  gitpreview_snapshot,
  gitpreview_title,
  gitpreview_version,
} from '@nibleaf/i18n/messages';
import { useLocale } from '@nibleaf/i18n/react';
import type { SiteSnapshot } from '@nibleaf/shared/site';
import { sitePathLanguages } from '@nibleaf/shared/site-language-policy';
import { parseSiteLanguagePath } from '@nibleaf/shared/site-language-prefix';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { Eye, FileText, GitPullRequest, Lock, Menu } from 'lucide-react';
import { type MouseEvent, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Markdown } from '@/components/markdown';
import { getGitPreviewFn } from '@/functions/site';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { previewScope } from '@/lib/git-preview';
import { setPendingDestination } from '@/lib/invitations';
import { safeDecode } from '@/lib/site-paths';

export const Route = createFileRoute('/git-preview/$token')({
  loader: async ({ params }): Promise<{ snapshot: SiteSnapshot } | { snapshot: null }> => {
    try {
      return JSON.parse(await getGitPreviewFn({ data: { token: params.token } })) as { snapshot: SiteSnapshot };
    } catch (error) {
      // A preview of a site that is not public opens only for its members.
      if (error instanceof ApiResponseError && error.status === 404 && error.reason === 'private') return { snapshot: null };
      throw error;
    }
  },
  head: () => ({ meta: [{ title: 'Pull request preview · Nibleaf' }, { name: 'robots', content: 'noindex,nofollow' }] }),
  component: GitPreviewRoute,
  errorComponent: GitPreviewUnavailable,
});

/** A bad, expired or replaced preview link, in the visitor's own interface language. */
function GitPreviewUnavailable() {
  const router = useRouter();
  // The server renders the visitor's interface language (the request's locale).
  const locale = useSyncExternalStore(subscribeLanguage, () => getLocale() as Locale, renderedLocale);
  const [retrying, setRetrying] = useState(false);
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10" dir={isRtl(locale) ? 'rtl' : 'ltr'} lang={locale}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center" role="alert">
        <GitPullRequest aria-hidden className="mx-auto size-6 text-muted-foreground" />
        <h1 className="mt-3 font-semibold text-lg">{gitpreview_invalidtitle({}, { locale })}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{gitpreview_invalidbody({}, { locale })}</p>
        <Button
          className="mt-5"
          loading={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await router.invalidate();
            } finally {
              setRetrying(false);
            }
          }}
          variant="outline"
        >
          {gitpreview_retry({}, { locale })}
        </Button>
      </div>
    </main>
  );
}

function GitPreviewRoute() {
  const { snapshot } = Route.useLoaderData();
  return snapshot ? <GitPreviewPage snapshot={snapshot} /> : <PrivatePreview />;
}

/** A signed-out visitor, or someone outside the site, opened a private site's preview. */
function PrivatePreview() {
  const { locale, t } = useLocale();
  const { token } = Route.useParams();
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center" dir={isRtl(locale) ? 'rtl' : 'ltr'} lang={locale}>
      <div className="flex max-w-sm flex-col items-center">
        <Lock aria-hidden className="size-8 text-muted-foreground" />
        <h1 className="mt-4 font-semibold text-2xl tracking-tight">{t('preview.privateTitle')}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{t('preview.privateBody')}</p>
        {/* Log in, then come back to this preview (the auth pages follow the pending destination). */}
        <a
          className={buttonVariants({ className: 'mt-5' })}
          href="/sign-in"
          onClick={() => setPendingDestination(`/git-preview/${encodeURIComponent(token)}`)}
        >
          {t('auth.otp.sendSignIn')}
        </a>
      </div>
    </div>
  );
}

function GitPreviewPage({ snapshot }: { snapshot: SiteSnapshot }) {
  const [requested, setRequested] = useState<{ language?: string; versionId?: string }>({});
  const scope = useMemo(() => previewScope(snapshot, requested), [snapshot, requested]);
  const { pages, language, version } = scope;
  const languages = useMemo(() => sitePathLanguages(snapshot), [snapshot]);
  const [pageId, setPageId] = useState(pages[0]?.id);
  const page = pages.find((item) => item.id === pageId) ?? pages[0];
  const [navOpen, setNavOpen] = useState(false);
  // The shell speaks the previewed language; a code with no interface translation reads in English.
  const locale: Locale = resolveLocale(language?.code) ?? 'en';
  const dir = language?.direction === 'RTL' ? 'rtl' : 'ltr';
  // Where to scroll once the opened page has rendered: a `#fragment` target, or the top.
  const [scrollTarget, setScrollTarget] = useState<{ fragment: string }>();
  useEffect(() => {
    if (!scrollTarget) return;
    let frame = 0;
    let attempts = 0;
    const scroll = () => {
      const target = scrollTarget.fragment ? document.getElementById(scrollTarget.fragment) : null;
      if (target) return target.scrollIntoView();
      // The article may still be rendering its headings; wait a few frames.
      if (scrollTarget.fragment && attempts++ < 30) {
        frame = requestAnimationFrame(scroll);
        return;
      }
      window.scrollTo({ top: 0 });
    };
    scroll();
    return () => cancelAnimationFrame(frame);
  }, [scrollTarget]);
  // Internal links carry the version's URL slug (none for the default
  // version), never its ID, and omit the default language, like the live site.
  const versionSlug = version && !version.isDefault ? version.slug : undefined;
  const defaultLanguage = snapshot.project.languages.find((item) => item.isDefault)?.code;
  const openPage = (id: string, fragment = '') => {
    setPageId(id);
    setNavOpen(false);
    setScrollTarget({ fragment });
  };
  // A link to another page of this snapshot opens that page here, so the
  // reviewer stays in the preview instead of landing on the published site.
  const openLinkInPreview = (event: MouseEvent<HTMLElement>) => {
    if (!page || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = (event.target as Element).closest?.('a[href]')?.getAttribute('href');
    if (!href) return;
    const url = new URL(href, window.location.href);
    const base = `/sites/${snapshot.project.id}`;
    if (url.origin !== window.location.origin || !(url.pathname === base || url.pathname.startsWith(`${base}/`))) return;
    const parsed = parseSiteLanguagePath(url.pathname.slice(base.length), languages);
    const segments = safeDecode(parsed.path);
    const path =
      versionSlug && (segments === versionSlug || segments.startsWith(`${versionSlug}/`))
        ? segments.slice(versionSlug.length).replace(/^\/+/, '')
        : segments;
    const languageCode = parsed.language?.code ?? url.searchParams.get('lang') ?? page.languageCode;
    const target = snapshot.pages.find(
      (item) => item.kind === 'PAGE' && !item.hidden && item.languageCode === languageCode && item.versionId === page.versionId && item.path === path,
    );
    if (!target) return;
    event.preventDefault();
    if (languageCode !== page.languageCode) setRequested((current) => ({ ...current, language: languageCode }));
    openPage(target.id, safeDecode(url.hash.slice(1)));
  };
  const changeScope = (next: { language?: string; versionId?: string }) => {
    const nextScope = previewScope(snapshot, { ...requested, ...next });
    setRequested({ language: nextScope.language?.code, versionId: nextScope.version?.id });
    // The same page in the new language or version when there is one, else its first page.
    const counterpart = nextScope.pages.find(
      (item) => (page?.translationKey && item.translationKey === page.translationKey) || item.path === page?.path,
    );
    openPage(counterpart?.id ?? nextScope.pages[0]?.id ?? '');
  };

  const navigation = (
    <>
      {scope.languages.length > 1 || scope.versions.length > 1 ? (
        <div className="grid gap-2 border-border border-b p-3">
          {scope.languages.length > 1 ? (
            <div className="grid gap-1">
              <span className="text-muted-foreground text-xs" id="git-preview-language">
                {gitpreview_language({}, { locale })}
              </span>
              <Select
                items={scope.languages.map((item) => ({ value: item.code, label: item.label }))}
                onValueChange={(next) => next && changeScope({ language: next })}
                value={language?.code ?? null}
              >
                <SelectTrigger aria-labelledby="git-preview-language" className="w-full" data-testid="git-preview-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scope.languages.map((item) => (
                    <SelectItem key={item.code} lang={item.code} value={item.code}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {scope.versions.length > 1 ? (
            <div className="grid gap-1">
              <span className="text-muted-foreground text-xs" id="git-preview-version">
                {gitpreview_version({}, { locale })}
              </span>
              <Select
                items={scope.versions.map((item) => ({ value: item.id, label: item.name }))}
                onValueChange={(next) => next && changeScope({ versionId: next })}
                value={version?.id ?? null}
              >
                <SelectTrigger aria-labelledby="git-preview-version" className="w-full" data-testid="git-preview-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scope.versions.map((item) => (
                    <SelectItem dir="auto" key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}
      <nav aria-label={gitpreview_pagesnav({}, { locale })} className="p-3">
        {pages.map((item) => (
          <button
            aria-current={item.id === page?.id ? 'page' : undefined}
            className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm ${item.id === page?.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
            key={item.id}
            // Open the page at its top, as an article link does.
            onClick={() => openPage(item.id)}
            type="button"
          >
            <FileText aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{item.title}</span>
          </button>
        ))}
      </nav>
    </>
  );
  const heading = (
    <div className="border-border border-b p-4">
      <div className="flex items-center gap-2 font-semibold text-sm">
        <GitPullRequest aria-hidden className="size-4" /> {gitpreview_title({}, { locale })}
      </div>
      <p className="mt-1 text-muted-foreground text-xs">{gitpreview_snapshot({}, { locale })}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background md:grid md:grid-cols-[280px_minmax(0,1fr)]" dir={dir} lang={language?.code}>
      {/* Phones: a top bar opens the page list as a drawer, so the article keeps the full width. */}
      <header className="sticky top-0 z-10 flex items-center gap-2 border-border border-b bg-card px-4 py-2 md:hidden">
        <Button aria-expanded={navOpen} onClick={() => setNavOpen(true)} size="sm" variant="outline">
          <Menu aria-hidden className="size-4" /> {gitpreview_openpages({}, { locale })}
        </Button>
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-sm">
          <GitPullRequest aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{gitpreview_title({}, { locale })}</span>
        </span>
      </header>
      <Sheet onOpenChange={setNavOpen} open={navOpen}>
        <SheetContent
          className="w-[85vw] max-w-xs gap-0 overflow-y-auto p-0"
          closeLabel={gitpreview_close({}, { locale })}
          dir={dir}
          lang={language?.code}
          side={dir === 'rtl' ? 'right' : 'left'}
        >
          <SheetTitle className="sr-only">{gitpreview_pagesnav({}, { locale })}</SheetTitle>
          {heading}
          {navigation}
        </SheetContent>
      </Sheet>
      <aside className="hidden min-h-screen flex-col border-border border-e bg-card/60 md:flex">
        {heading}
        <ScrollArea className="flex-1">{navigation}</ScrollArea>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 md:p-10">
        {/* The article's own links stay the interactive elements; this only routes their clicks. */}
        <article className="mx-auto max-w-4xl" onClickCapture={openLinkInPreview}>
          {page ? (
            <>
              <div className="mb-8 border-border border-b pb-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <Eye aria-hidden className="size-4 shrink-0" />
                    <bdi className="truncate" dir="ltr">
                      {page.path || '/'}
                    </bdi>
                  </span>
                  {/* Which language and version this is, so equal titles across scopes stay distinct. */}
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                    {[language?.label, scope.versions.length > 1 ? version?.name : null].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <h1 className="mt-2 break-words font-semibold text-2xl tracking-tight md:text-3xl">{page.title}</h1>
                {page.description ? <p className="mt-2 text-muted-foreground">{page.description}</p> : null}
              </div>
              <Markdown
                content={page.content}
                site={{ projectId: snapshot.project.id, lang: page.languageCode, defaultLanguage, version: versionSlug, languages, path: page.path }}
              />
            </>
          ) : (
            <p className="text-muted-foreground">{gitpreview_empty({}, { locale })}</p>
          )}
        </article>
      </main>
    </div>
  );
}
