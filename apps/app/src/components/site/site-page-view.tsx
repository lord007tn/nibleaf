import { cn } from '@nibleaf/design-system/lib/utils';
import { siteT } from '@nibleaf/i18n/site';
import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { CalendarClock, Check, ChevronLeft, ChevronRight, CircleAlert, Clock3, Image, PencilLine, ThumbsDown, ThumbsUp } from 'lucide-react';
import { type ComponentProps, Suspense, startTransition, useEffect, useState } from 'react';
import { SiteChatPageAction } from '@/components/site/ai-chat/provider';
import { DocumentationPageLayout } from '@/components/site/documentation-theme-provider';
import { useSitePageAlternates } from '@/components/site/page-alternates-context';
import { ArticleBodySkeleton } from '@/components/site/site-article-skeleton';
import { MobileTableOfContents, TableOfContents } from '@/components/site/toc';
import type { ProjectConfig, SitePage } from '@/hooks/api/types';
import { localeTag } from '@/lib/format';
import { HydrationIsland } from '@/lib/hydration-modules';
import { articleMarkdownModule } from '@/lib/reader-hydration-modules';
import { siteHref } from '@/lib/site-paths';
import { useSiteAnalytics } from '@/providers/site-analytics-provider';

const ARTICLE_MODULES = [articleMarkdownModule];

/** The article body. The router loads its renderer before hydrating a page
 *  whose server HTML has an article, and the reader's loaders before navigating
 *  to one. A body that suspended while hydrating lost its server HTML to the
 *  fallback (READER-03). If the renderer can't load, hydrating keeps the
 *  server's body and a client navigation says so here; neither shows the
 *  route's error page. */
function ArticleBody({ language, ...props }: ComponentProps<typeof import('@/components/markdown').Markdown> & { language?: string }) {
  const t = siteT(language);
  return (
    // Only the server render can suspend here: it waits for the renderer.
    <Suspense fallback={<ArticleBodySkeleton className="mt-8" />}>
      <HydrationIsland
        className="mt-8"
        {...articleMarkdownModule.marker}
        modules={ARTICLE_MODULES}
        pending={<ArticleBodySkeleton />}
        failed={(retry) => (
          <div role="alert">
            <button
              className="min-h-11 w-full cursor-pointer rounded-xl border border-border p-5 text-start text-sm transition-colors hover:text-primary"
              onClick={retry}
              type="button"
            >
              {t('articleLoadFailed')}
            </button>
          </div>
        )}
      >
        {() => {
          const Markdown = articleMarkdownModule.read();
          return <Markdown {...props} />;
        }}
      </HydrationIsland>
    </Suspense>
  );
}

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

/** The dark-mode twin of a light/dark image pair (`hidden dark:block`): the
 *  reader sees one screenshot, not two. */
const isDarkModeTwin = (image: string): boolean => {
  // class="…", className="…" or className={"…"}
  const classes = image.match(/\bclass(?:Name)?=\{?["']([^"']*)["']\}?/)?.[1]?.split(/\s+/) ?? [];
  return classes.includes('hidden') && classes.some((name) => name.startsWith('dark:') && name !== 'dark:hidden');
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
  const { track } = useSiteAnalytics();
  const [sentiment, setSentiment] = useState<'helpful' | 'not_helpful' | null>(null);
  const [pageUrl, setPageUrl] = useState(() => `/sites/${projectId}/${path}`);
  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);
  const editUrl = addons?.editSuggestions !== false ? applyUrlTemplate(addons?.editUrl, path, pageUrl) : null;
  const issueUrl = addons?.issueLinks !== false ? applyUrlTemplate(addons?.issueUrl, path, pageUrl) : null;
  const showFeedback = addons?.feedback !== false;
  const presentation = addons?.feedbackPresentation ?? 'compact';

  if (!showFeedback && !editUrl && !issueUrl) {
    return null;
  }

  const sendFeedback = (query: 'helpful' | 'not_helpful') => {
    setSentiment(query);
    track({ name: 'feedback_submitted', path, feedback: query, target: 'page' });
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between',
        presentation === 'card' ? 'mt-8 rounded-xl border border-border bg-muted/30 p-4 sm:p-5' : 'mt-14 border-border/70 border-t pt-6',
      )}
      data-theme-region="reader-actions"
    >
      {showFeedback ? (
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
          <span>{t('feedbackQuestion')}</span>
          <div className="flex items-center gap-1.5">
            <button
              className="grid size-11 cursor-pointer place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-primary aria-pressed:border-primary aria-pressed:text-primary"
              onClick={() => sendFeedback('helpful')}
              type="button"
              aria-label={t('feedbackYes')}
              aria-pressed={sentiment === 'helpful'}
            >
              <ThumbsUp className="size-4" aria-hidden />
            </button>
            <button
              className="grid size-11 cursor-pointer place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-primary aria-pressed:border-primary aria-pressed:text-primary"
              onClick={() => sendFeedback('not_helpful')}
              type="button"
              aria-label={t('feedbackNo')}
              aria-pressed={sentiment === 'not_helpful'}
            >
              <ThumbsDown className="size-4" aria-hidden />
            </button>
          </div>
          <span role="status" className="inline-flex min-h-6 items-center gap-1.5 text-foreground">
            {sentiment ? (
              <>
                <Check className="size-4 text-primary" aria-hidden />
                {t('feedbackThanks')}
              </>
            ) : null}
          </span>
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
    // Language-switcher metadata must not interrupt a still-hydrating article.
    startTransition(() => setAlternates(data?.languages ?? []));
    return () => startTransition(() => setAlternates([]));
  }, [data?.languages, setAlternates]);

  const { page, breadcrumbs, prev, next } = data;
  const language = data.activeLanguage ?? lang;
  // Build links with the RESOLVED version, not the raw first-path-segment
  // candidate the route passes in: for a page like `getting-started/quickstart`
  // that candidate is a content segment, and prefixing it onto sibling links
  // would produce `/getting-started/getting-started/…`.
  const resolvedVersion = data.versions.find((item) => item.slug === data.activeVersion);
  const versionPrefix = resolvedVersion && !resolvedVersion.isDefault ? resolvedVersion.slug : undefined;
  const defaultLanguage = data.languages.find((item) => item.isDefault)?.code;
  const navigationLanguage = data.activeLanguage !== defaultLanguage ? data.activeLanguage : undefined;
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
  const readerActionsAfterNavigation = addons?.feedbackPlacement === 'after-navigation';
  const readableText = page.content
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[`#*_>[\](){}|~-]/g, ' ');
  const readingMinutes = Math.max(1, Math.ceil(readableText.split(/\s+/).filter(Boolean).length / 220));
  const imageCount = (protectMarkdownCode(page.content).content.match(/!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gi) ?? []).filter(
    (image) => !isDarkModeTwin(image),
  ).length;
  // A UTC calendar day, so the server render and a reader in any timezone show
  // the same date and hydration matches.
  const updatedLabel = new Intl.DateTimeFormat(localeTag(language || 'en'), { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(page.updatedAt),
  );
  const article = (
    <article
      className={cn('w-full min-w-0', mode === 'wide' ? '' : mode === 'center' ? 'mx-auto max-w-[42rem]' : 'mx-auto max-w-[46rem]')}
      data-theme-region="article"
    >
      {/* Eyebrow: the page's section trail, accent-colored (Mintlify-style). */}
      {ancestors.length > 0 ? (
        <nav className="mb-3" aria-label={tArticle('breadcrumb')}>
          <ol className="flex flex-wrap items-center gap-1.5 font-semibold text-primary text-sm">
            {ancestors.map((crumb, index) => (
              <li key={crumb.path} className="flex items-center gap-1.5">
                {index > 0 ? (
                  <span className="text-muted-foreground/60" aria-hidden>
                    /
                  </span>
                ) : null}
                <a
                  href={siteHref(projectId, crumb.path, { lang: navigationLanguage, version: versionPrefix })}
                  className="transition-opacity hover:opacity-80"
                >
                  {crumb.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1 tabIndex={-1} className="outline-none font-semibold text-3xl tracking-tight md:text-4xl">
        {page.title}
      </h1>
      {page.description ? <p className="mt-3 text-lg text-muted-foreground">{page.description}</p> : null}
      <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-xs" aria-label={tArticle('articleDetails')}>
        <li className="inline-flex items-center gap-1.5">
          <Clock3 className="size-3.5" aria-hidden /> {tArticle('minReadCount', { count: readingMinutes })}
        </li>
        {imageCount > 0 ? (
          <li className="inline-flex items-center gap-1.5">
            <Image className="size-3.5" aria-hidden /> {tArticle('screenshotCount', { count: imageCount })}
          </li>
        ) : null}
        <li className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-3.5" aria-hidden /> {tArticle('updated')} <time dateTime={page.updatedAt}>{updatedLabel}</time>
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
      {/* Below the wide breakpoint the outline sits after the page header, where readers look for it. */}
      {showToc ? (
        <div className="mt-6">
          <MobileTableOfContents headings={page.headings} label={tArticle('onThisPage')} />
        </div>
      ) : null}
      <ArticleBody content={page.content} language={language} site={{ projectId, lang: language, defaultLanguage, version: versionPrefix }} />

      <SiteChatPageAction title={page.title} path={page.path} lang={language} />
      {readerActionsAfterNavigation ? null : (
        <ReaderActions
          key={JSON.stringify([projectId, page.path, language, data.activeVersion])}
          projectId={projectId}
          path={page.path}
          language={language}
          addons={addons}
        />
      )}

      {prev || next ? (
        <nav
          className={cn(
            'flex items-center justify-between gap-6 text-sm',
            hasReaderActions && !readerActionsAfterNavigation ? 'mt-8' : 'mt-14 border-border/70 border-t pt-6',
          )}
          data-theme-region="pager"
          aria-label={`${tArticle('previous')} / ${tArticle('next')}`}
        >
          {prev ? (
            <a
              href={siteHref(projectId, prev.path, { lang: navigationLanguage, version: versionPrefix })}
              className="group inline-flex min-h-11 min-w-0 max-w-[48%] items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <ChevronLeft className="size-4 shrink-0 rtl:-scale-x-100" />
              <span className="min-w-0">
                <span className="mb-1 block text-muted-foreground text-xs">{tArticle('previous')}</span>
                <span className="line-clamp-2 break-words">{prev.title}</span>
              </span>
            </a>
          ) : (
            <span />
          )}
          {next ? (
            <a
              href={siteHref(projectId, next.path, { lang: navigationLanguage, version: versionPrefix })}
              className="group inline-flex min-h-11 min-w-0 max-w-[48%] items-center gap-1.5 text-end font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <span className="min-w-0">
                <span className="mb-1 block text-muted-foreground text-xs">{tArticle('next')}</span>
                <span className="line-clamp-2 break-words">{next.title}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 rtl:-scale-x-100" />
            </a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
      {readerActionsAfterNavigation ? (
        <ReaderActions
          key={JSON.stringify([projectId, page.path, language, data.activeVersion])}
          projectId={projectId}
          path={page.path}
          language={language}
          addons={addons}
        />
      ) : null}
    </article>
  );

  return (
    <DocumentationPageLayout
      article={article}
      tableOfContents={showToc ? <TableOfContents headings={page.headings} label={tArticle('onThisPage')} /> : undefined}
    />
  );
}
