import { buttonVariants } from '@nibleaf/design-system/components/ui/button';
import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { isRtl } from '@nibleaf/i18n/locales';
import { useLocale } from '@nibleaf/i18n/react';
import type { SiteSnapshot } from '@nibleaf/shared/site';
import { createFileRoute } from '@tanstack/react-router';
import { Eye, FileText, GitPullRequest, Lock } from 'lucide-react';
import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { getGitPreviewFn } from '@/functions/site';
import { ApiResponseError } from '@/hooks/api/client-helpers';
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
});

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
  const pages = useMemo(() => snapshot.pages.filter((page) => page.kind === 'PAGE' && !page.hidden), [snapshot.pages]);
  const [pageId, setPageId] = useState(pages[0]?.id);
  const page = pages.find((item) => item.id === pageId) ?? pages[0];
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
  const version = snapshot.project.versions.find((item) => item.id === page?.versionId);
  const versionSlug = version && !version.isDefault ? version.slug : undefined;
  const defaultLanguage = snapshot.project.languages.find((item) => item.isDefault)?.code;
  // A link to another page of this snapshot opens that page here, so the
  // reviewer stays in the preview instead of landing on the published site.
  const openLinkInPreview = (event: MouseEvent<HTMLElement>) => {
    if (!page || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = (event.target as Element).closest?.('a[href]')?.getAttribute('href');
    if (!href) return;
    const url = new URL(href, window.location.href);
    const base = `/sites/${snapshot.project.id}`;
    if (url.origin !== window.location.origin || !(url.pathname === base || url.pathname.startsWith(`${base}/`))) return;
    const segments = safeDecode(url.pathname.slice(base.length)).replace(/^\/+|\/+$/g, '');
    const path =
      versionSlug && (segments === versionSlug || segments.startsWith(`${versionSlug}/`))
        ? segments.slice(versionSlug.length).replace(/^\/+/, '')
        : segments;
    // An authored `?lang=` picks that language's page; otherwise stay in this one.
    const language = url.searchParams.get('lang') ?? page.languageCode;
    const target = pages.find((item) => item.languageCode === language && item.versionId === page.versionId && item.path === path);
    if (!target) return;
    event.preventDefault();
    setPageId(target.id);
    setScrollTarget({ fragment: safeDecode(url.hash.slice(1)) });
  };
  return (
    <div className="grid min-h-screen grid-cols-[280px_1fr] bg-background">
      <aside className="flex min-h-screen flex-col border-border border-e bg-card/60">
        <div className="border-border border-b p-4">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <GitPullRequest className="size-4" /> Pull request preview
          </div>
          <p className="mt-1 text-muted-foreground text-xs">Immutable snapshot · not indexed</p>
        </div>
        <ScrollArea className="flex-1">
          <nav className="p-3" aria-label="Preview pages">
            {pages.map((item) => (
              <button
                className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm ${item.id === page?.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                key={item.id}
                onClick={() => {
                  setPageId(item.id);
                  // Open the page at its top, as an article link does.
                  setScrollTarget({ fragment: '' });
                }}
                type="button"
              >
                <FileText className="size-3.5" />
                <span className="truncate">{item.title}</span>
              </button>
            ))}
          </nav>
        </ScrollArea>
      </aside>
      <main className="min-w-0 p-10">
        {/* The article's own links stay the interactive elements; this only routes their clicks. */}
        <article className="mx-auto max-w-4xl" onClickCapture={openLinkInPreview}>
          {page ? (
            <>
              <div className="mb-8 border-border border-b pb-5">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Eye className="size-4" /> {page.path || '/'}
                </div>
                <h1 className="mt-2 font-semibold text-3xl tracking-tight">{page.title}</h1>
                {page.description ? <p className="mt-2 text-muted-foreground">{page.description}</p> : null}
              </div>
              <Markdown
                content={page.content}
                site={{ projectId: snapshot.project.id, lang: page.languageCode, defaultLanguage, version: versionSlug }}
              />
            </>
          ) : (
            <p className="text-muted-foreground">This preview contains no visible pages.</p>
          )}
        </article>
      </main>
    </div>
  );
}
