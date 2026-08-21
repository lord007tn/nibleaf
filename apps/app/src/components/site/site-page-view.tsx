import { cn } from '@nibleaf/design-system/lib/utils';
import { CalendarClock, Check, ChevronLeft, ChevronRight, CircleAlert, Clock3, Image, PencilLine, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { useSitePageAlternates } from '@/components/site/page-alternates-context';
import { TableOfContents } from '@/components/site/toc';
import type { ProjectConfig, SitePage } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { siteT } from '@/lib/site-i18n';
import { siteHref } from '@/lib/site-paths';

const randomSessionId = (): string => {
  const words = new Uint32Array(4);
  window.crypto.getRandomValues(words);
  return Array.from(words, (value) => value.toString(36)).join('.');
};

const sessionId = (): string => {
  if (typeof window === 'undefined') {
    return 'ssr';
  }
  const key = 'nibleaf.sid';
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = randomSessionId();
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

/** "Was this page helpful?" + edit/issue links, rendered at the end of the
 *  article so it always aligns with the reading column. */
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
          sessionId: sessionId(),
          referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
          language,
        },
      })
      .catch(() => undefined);
  };

  return (
    <div className="mt-14 flex flex-col gap-4 border-border/70 border-t pt-6 text-sm sm:flex-row sm:items-center sm:justify-between">
      {showFeedback ? (
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
          {sentiment ? (
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <Check className="size-4 text-primary" /> {t('feedbackThanks')}
            </span>
          ) : (
            <>
              <span>{t('feedbackQuestion')}</span>
              <div className="flex items-center gap-1.5">
                <button
                  className="grid size-8 cursor-pointer place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  onClick={() => sendFeedback('helpful')}
                  type="button"
                  aria-label={t('feedbackYes')}
                >
                  <ThumbsUp className="size-3.5" />
                </button>
                <button
                  className="grid size-8 cursor-pointer place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  onClick={() => sendFeedback('not_helpful')}
                  type="button"
                  aria-label={t('feedbackNo')}
                >
                  <ThumbsDown className="size-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div />
      )}

      {editUrl || issueUrl ? (
        <div className="flex flex-wrap items-center gap-4">
          {editUrl ? (
            <a
              className="inline-flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
              href={editUrl}
              rel="noreferrer"
              target="_blank"
            >
              <PencilLine className="size-3.5" /> {t('editPage')}
            </a>
          ) : null}
          {issueUrl ? (
            <a
              className="inline-flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
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
  );
}

export function SitePageView({ projectId, lang, data }: { projectId: string; lang?: string; data: SitePage }) {
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

  const { page, breadcrumbs, prev, next } = data;
  const language = data.activeLanguage ?? lang;
  // Build links with the RESOLVED version, not the raw first-path-segment
  // candidate the route passes in: for a page like `getting-started/quickstart`
  // that candidate is a content segment, and prefixing it onto sibling links
  // would produce `/getting-started/getting-started/…`.
  const resolvedVersion = data.versions.find((item) => item.slug === data.activeVersion);
  const versionPrefix = resolvedVersion && !resolvedVersion.isDefault ? resolvedVersion.slug : undefined;
  // Article-level chrome strings follow the page's RESOLVED language (which can
  // differ from the URL param on fallback pages) so labels match the content.
  const tArticle = siteT(language);
  // Per-page layout behaviour (Mintlify-style `mode`/`hideToc`): `wide` drops the
  // TOC and fills the width, `center` narrows + centers the column.
  const mode = page.config?.mode ?? 'default';
  const showToc = mode === 'default' && !page.config?.hideToc && page.headings.length > 0;
  const ancestors = breadcrumbs.slice(0, -1);
  // Whether ReaderActions will render — when it doesn't, the prev/next pager
  // takes over the article-footer divider it normally provides.
  const addons = data.project.config?.addons;
  const hasReaderActions =
    addons?.feedback !== false ||
    (addons?.editSuggestions !== false && Boolean(addons?.editUrl?.trim())) ||
    (addons?.issueLinks !== false && Boolean(addons?.issueUrl?.trim()));
  const readableText = page.content
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[`#*_>[\](){}|~-]/g, ' ');
  const readingMinutes = Math.max(1, Math.ceil(readableText.split(/\s+/).filter(Boolean).length / 220));
  const imageCount = (page.content.match(/!\[[^\]]*\]\([^)]*\)|<img\b/gi) ?? []).length;
  const updatedLabel = new Intl.DateTimeFormat(language || 'en', { dateStyle: 'medium' }).format(new Date(page.updatedAt));

  const article = (
    <article className={cn('w-full min-w-0', mode === 'wide' ? '' : 'mx-auto max-w-[46rem]')}>
      {/* Eyebrow: the page's section trail, accent-colored (Mintlify-style). */}
      {ancestors.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 font-semibold text-primary text-sm">
          {ancestors.map((crumb, index) => (
            <span key={crumb.path} className="flex items-center gap-1.5">
              {index > 0 ? (
                <span className="text-muted-foreground/60" aria-hidden>
                  /
                </span>
              ) : null}
              <a href={siteHref(projectId, crumb.path, { lang, version: versionPrefix })} className="transition-opacity hover:opacity-80">
                {crumb.title}
              </a>
            </span>
          ))}
        </div>
      ) : null}
      <h1 className="font-semibold text-3xl tracking-tight md:text-4xl">{page.title}</h1>
      {page.description ? <p className="mt-3 text-lg text-muted-foreground">{page.description}</p> : null}
      <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-xs" aria-label={tArticle('articleDetails')}>
        <li className="inline-flex items-center gap-1.5">
          <Clock3 className="size-3.5" aria-hidden /> {readingMinutes} {tArticle('minRead')}
        </li>
        {imageCount > 0 ? (
          <li className="inline-flex items-center gap-1.5">
            <Image className="size-3.5" aria-hidden /> {imageCount} {tArticle(imageCount === 1 ? 'screenshot' : 'screenshots')}
          </li>
        ) : null}
        <li className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-3.5" aria-hidden /> {tArticle('updated')} {updatedLabel}
        </li>
      </ul>
      {page.config?.tags?.length ? (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label={tArticle('tags')}>
          {page.config.tags.map((tag) => (
            <li className="rounded-full border border-border bg-muted/45 px-2.5 py-1 font-medium text-muted-foreground text-xs" key={tag}>
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-8">
        <Markdown content={page.content} site={{ projectId, lang: language, version: versionPrefix }} />
      </div>

      <ReaderActions projectId={projectId} path={page.path} language={language} addons={addons} />

      {prev || next ? (
        <nav
          className={cn('flex items-center justify-between gap-6 text-sm', hasReaderActions ? 'mt-8' : 'mt-14 border-border/70 border-t pt-6')}
          aria-label={`${tArticle('previous')} / ${tArticle('next')}`}
        >
          {prev ? (
            <a
              href={siteHref(projectId, prev.path, { lang, version: versionPrefix })}
              className="group inline-flex min-w-0 items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <ChevronLeft className="size-4 shrink-0 rtl:-scale-x-100" />
              <span className="truncate">{prev.title}</span>
            </a>
          ) : (
            <span />
          )}
          {next ? (
            <a
              href={siteHref(projectId, next.path, { lang, version: versionPrefix })}
              className="group inline-flex min-w-0 items-center gap-1.5 text-end font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <span className="truncate">{next.title}</span>
              <ChevronRight className="size-4 shrink-0 rtl:-scale-x-100" />
            </a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </article>
  );

  if (mode === 'center') {
    return <div className="mx-auto min-w-0 max-w-[42rem] py-9 lg:py-12">{article}</div>;
  }
  if (!showToc) {
    return <div className="min-w-0 py-9 lg:py-12">{article}</div>;
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-12 py-9 lg:py-12 xl:grid-cols-[minmax(0,1fr)_13rem]">
      {article}
      <aside className="hidden xl:block">
        <TableOfContents headings={page.headings} label={tArticle('onThisPage')} />
      </aside>
    </div>
  );
}
