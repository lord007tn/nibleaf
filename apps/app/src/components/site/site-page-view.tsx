import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { Markdown } from '@/components/markdown';
import { useSitePageAlternates } from '@/components/site/page-alternates-context';
import { TableOfContents } from '@/components/site/toc';
import { useSitePage } from '@/hooks/api';
import type { SitePage } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { siteT } from '@/lib/site-i18n';
import { siteHref } from '@/lib/site-paths';

const sessionId = (): string => {
  if (typeof window === 'undefined') {
    return 'ssr';
  }
  const key = 'nibleaf.sid';
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2);
    window.localStorage.setItem(key, id);
  }
  return id;
};

export function SitePageView({
  projectId,
  path,
  lang,
  version,
  initialData,
}: {
  projectId: string;
  path: string;
  lang?: string;
  version?: string;
  initialData?: SitePage;
}) {
  const t = siteT(lang);
  const { data, isPending, isError } = useSitePage(projectId, path, lang, initialData, version);
  const { setAlternates } = useSitePageAlternates();

  useEffect(() => {
    setAlternates(data?.languages ?? []);
    return () => setAlternates([]);
  }, [data?.languages, setAlternates]);

  // Record a pageview whenever the resolved page changes. (The document title +
  // meta description are owned by the route's head() so they render server-side.)
  useEffect(() => {
    if (data?.page.path) {
      api.public.sites[':id'].events
        .$post({
          param: { id: projectId },
          json: {
            type: 'pageview',
            path: data.page.path,
            sessionId: sessionId(),
            referrer: document.referrer || undefined,
            language: data.activeLanguage ?? lang,
          },
        })
        .catch(() => undefined);
    }
  }, [data?.page.path, data?.activeLanguage, lang, projectId]);

  if (isPending) {
    return <div className="px-10 py-12 text-muted-foreground text-sm">{t('loading')}</div>;
  }
  if (isError || !data) {
    return <div className="px-10 py-12 text-muted-foreground text-sm">{t('pageUnavailable')}</div>;
  }

  const { page, breadcrumbs, prev, next } = data;
  // Per-page layout behaviour (Mintlify-style `mode`/`hideToc`): `wide` drops the
  // TOC and fills the width, `center` narrows + centers the column.
  const mode = page.config?.mode ?? 'default';
  const showToc = mode === 'default' && !page.config?.hideToc && page.headings.length > 0;

  return (
    <div
      className={
        showToc
          ? 'grid min-w-0 grid-cols-1 gap-10 px-8 py-10 xl:grid-cols-[1fr_200px]'
          : mode === 'wide'
            ? 'min-w-0 px-8 py-10' // full-bleed, reserved for explicit wide mode
            : mode === 'center'
              ? 'mx-auto min-w-0 max-w-3xl px-8 py-10'
              : 'mx-auto min-w-0 max-w-4xl px-8 py-10' // default but no TOC → keep a constrained reading column
      }
    >
      <article className="min-w-0">
        {breadcrumbs.length > 1 ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
            {breadcrumbs.slice(0, -1).map((crumb) => (
              <span key={crumb.path} className="flex items-center gap-1.5">
                <a href={siteHref(projectId, crumb.path, { lang, version })} className="transition-colors hover:text-foreground">
                  {crumb.title}
                </a>
                <span aria-hidden>/</span>
              </span>
            ))}
          </div>
        ) : null}
        <h1 className="font-semibold text-4xl tracking-tight">{page.title}</h1>
        {page.description ? <p className="mt-2 text-lg text-muted-foreground">{page.description}</p> : null}
        <div className="mt-6">
          <Markdown content={page.content} site={{ projectId, lang, version }} />
        </div>

        <div className="mt-12 grid grid-cols-2 gap-3 border-border border-t pt-6">
          {prev ? (
            <a
              href={siteHref(projectId, prev.path, { lang, version })}
              className="flex flex-col items-start rounded-xl border border-border p-4 hover:bg-muted"
            >
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                <ChevronLeft className="size-3 rtl:-scale-x-100" /> {t('previous')}
              </span>
              <span className="mt-1 font-medium">{prev.title}</span>
            </a>
          ) : (
            <span />
          )}
          {next ? (
            <a
              href={siteHref(projectId, next.path, { lang, version })}
              className="flex flex-col items-end rounded-xl border border-border p-4 text-end hover:bg-muted"
            >
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                {t('next')} <ChevronRight className="size-3 rtl:-scale-x-100" />
              </span>
              <span className="mt-1 font-medium">{next.title}</span>
            </a>
          ) : (
            <span />
          )}
        </div>
      </article>

      {/* Table of contents — hidden in wide/center mode or when hideToc is set */}
      <aside className="hidden xl:block">{showToc ? <TableOfContents headings={page.headings} label={t('onThisPage')} /> : null}</aside>
    </div>
  );
}
