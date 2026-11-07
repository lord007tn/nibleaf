import { siteT } from '@nibleaf/i18n/site';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { SiteNotFound } from '@/components/site/site-not-found';
import { useSiteReader } from '@/components/site/site-reader-context';
import { getSiteFn, listSiteChangelogFn } from '@/functions/site';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import type { ChangelogEntry, SiteShell } from '@/hooks/api/types';
import { localeTag } from '@/lib/format';
import { customDomainOrigin } from '@/lib/site-origin';
import { changelogFeedUrl, pageHead, readerFallbackHead, siteLanguageFromMatches, sitePageUrl } from '@/lib/site-seo';

export const Route = createFileRoute('/sites/$projectId/changelog')({
  component: SiteChangelog,
  // Missing pages stay inside the documentation, in the site's language.
  notFoundComponent: SiteNotFound,
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // Reuse the parent shell for SSR metadata and client navigation.
  loader: async ({ params, deps, parentMatchPromise }) => {
    let site: SiteShell;
    try {
      const parent = await parentMatchPromise;
      if (parent?.status === 'error') throw parent.error;
      const parentSite = (parent?.loaderData as { site?: SiteShell | null } | undefined)?.site;
      if (parentSite === null) throw notFound();
      site = parentSite ?? (await getSiteFn({ data: { projectId: params.projectId, language: deps.lang } }));
    } catch (error) {
      // A missing or privacy-hidden site is a real 404, not an empty changelog
      // served as 200; other failures reach the retryable error boundary.
      if (error instanceof ApiResponseError && error.status === 404) throw notFound();
      throw error;
    }
    let entries: ChangelogEntry[] = [];
    try {
      entries = await listSiteChangelogFn({ data: { projectId: params.projectId } });
    } catch {
      // The shell still owns SEO/chrome when the optional feed is unavailable.
    }
    return { site, entries, lang: deps.lang, siteOrigin: customDomainOrigin() };
  },
  head: ({ loaderData, params, match, matches }) => {
    if (match.status === 'error') return readerFallbackHead(matches, siteLanguageFromMatches(matches));
    const site = loaderData?.site;
    // A missing site renders the not-found page: no canonical or feed for it.
    if (!site) return pageHead(null, params.projectId, siteLanguageFromMatches(matches));
    const config = (site?.project.config ?? null) as { seo?: { metaTitle?: string; metaDescription?: string } } | null;
    // Same cascade as pageHead: language SEO › project SEO › the language's
    // localized site name/description › project name/description.
    const langCfg = site?.languageConfig ?? null;
    const t = siteT(site.activeLanguage);
    const name = langCfg?.seo?.metaTitle || config?.seo?.metaTitle || langCfg?.name || site?.project.name || t('documentation');
    const description =
      langCfg?.seo?.metaDescription || config?.seo?.metaDescription || langCfg?.description || site?.project.description || t('changelogSubtitle');
    // Canonicalize to the site's one base (primary domain › subdomain › self).
    const project = site?.project;
    const url = sitePageUrl(params.projectId, 'changelog', loaderData?.lang, {
      primaryDomain: project?.primaryDomain,
      slug: project?.slug,
      requestOrigin: loaderData?.siteOrigin,
    });
    return {
      meta: [{ title: `${t('changelog')} — ${name}` }, { name: 'description', content: description }],
      links: [
        { rel: 'canonical', href: url },
        { rel: 'alternate', type: 'application/rss+xml', title: `${t('changelog')} — ${name}`, href: changelogFeedUrl(url) },
      ],
    };
  },
});

const parse = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
// Release dates are calendar days in UTC: the server render and every
// reader's browser format the same day, whatever their timezone, so hydration
// matches and an entry never jumps to the neighbouring month group.
const formatDate = (value: string | null, lang?: string): string => {
  const date = parse(value);
  return date ? date.toLocaleDateString(localeTag(lang || 'en'), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
};
const monthKey = (value: string | null): string => {
  const date = parse(value);
  return date ? `${date.getUTCFullYear()}-${date.getUTCMonth()}` : 'unknown';
};
const monthLabel = (value: string | null, lang?: string): string => {
  const date = parse(value);
  return date ? date.toLocaleDateString(localeTag(lang || 'en'), { year: 'numeric', month: 'long', timeZone: 'UTC' }) : '';
};

/** Group entries (already newest-first) into consecutive month sections. */
function groupByMonth(entries: ChangelogEntry[], lang?: string): Array<{ key: string; label: string; entries: ChangelogEntry[] }> {
  const groups: Array<{ key: string; label: string; entries: ChangelogEntry[] }> = [];
  for (const entry of entries) {
    const key = monthKey(entry.date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.entries.push(entry);
    } else {
      groups.push({ key, label: monthLabel(entry.date, lang), entries: [entry] });
    }
  }
  return groups;
}

function SiteChangelog() {
  const { entries, site } = Route.useLoaderData();
  // The language the reader chrome resolved: the default language has no
  // `?lang=`, so the URL alone would leave an Arabic-default site in English.
  const lang = useSiteReader()?.lang ?? site.activeLanguage;
  const t = siteT(lang);
  const groups = groupByMonth(entries, lang);

  return (
    // Horizontal gutters come from the route's content wrapper (px-4 sm:px-6).
    <div className="mx-auto min-h-[560px] max-w-[820px] py-9 lg:py-12">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </span>
        <h1 tabIndex={-1} className="font-bold text-3xl tracking-tight outline-none">
          {t('changelog')}
        </h1>
      </div>
      <p className="mt-2 text-muted-foreground text-sm">{t('changelogSubtitle')}</p>

      <div className="mt-10">
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('changelogEmpty')}</p>
        ) : (
          <div className="space-y-10">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="mb-4 font-semibold text-[11px] text-muted-foreground/80 uppercase tracking-wider">{group.label}</h2>
                <div className="space-y-2.5">
                  {group.entries.map((entry) => (
                    <article
                      id={`release-v${entry.version}`}
                      key={entry.version}
                      className="scroll-mt-24 flex items-start gap-4 rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex h-11 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 leading-none">
                        <span className="font-mono font-bold text-[15px] text-primary">v{entry.version}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold text-[15px] text-foreground tracking-tight">{entry.title}</h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[10.5px] text-primary uppercase tracking-wide">
                            {t('changelogRelease')}
                          </span>
                          {entry.date ? <time dateTime={entry.date}>{formatDate(entry.date, lang)}</time> : null}
                          <span aria-hidden>·</span>
                          <span>{t('changelogPageCount', { count: entry.pages })}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
