import { createFileRoute, useSearch } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { getData } from '@/hooks/api/client-helpers';
import type { ChangelogEntry, SiteShell } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { siteT } from '@/lib/site-i18n';
import { customDomainOrigin } from '@/lib/site-origin';
import { changelogFeedUrl, sitePageUrl } from '@/lib/site-seo';

export const Route = createFileRoute('/sites/$projectId/changelog')({
  component: SiteChangelog,
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  // Fetch the site shell server-side so the changelog gets a real SSR <title>
  // and canonical (the changelog route renders no SitePageView to own the head).
  loader: async ({ params, deps }) => {
    try {
      const site = await getData<SiteShell>(
        await api.public.sites[':id'].$get({
          param: { id: params.projectId },
          query: deps.lang ? { lang: deps.lang } : {},
        }),
        'site',
      );
      let entries: ChangelogEntry[] = [];
      try {
        entries = await getData<ChangelogEntry[]>(await api.public.sites[':id'].changelog.$get({ param: { id: params.projectId } }), 'changelog');
      } catch {
        // The shell still owns SEO/chrome when the optional feed is unavailable.
      }
      return { site, entries, lang: deps.lang, siteOrigin: customDomainOrigin() };
    } catch {
      return { site: null, entries: [] as ChangelogEntry[], lang: deps.lang, siteOrigin: customDomainOrigin() };
    }
  },
  head: ({ loaderData, params }) => {
    const site = loaderData?.site ?? null;
    const config = (site?.project.config ?? null) as { seo?: { metaTitle?: string; metaDescription?: string } } | null;
    // Same cascade as pageHead: language SEO › project SEO › the language's
    // localized site name/description › project name/description.
    const langCfg = site?.languageConfig ?? null;
    const name = langCfg?.seo?.metaTitle || config?.seo?.metaTitle || langCfg?.name || site?.project.name || 'Documentation';
    const description =
      langCfg?.seo?.metaDescription ||
      config?.seo?.metaDescription ||
      langCfg?.description ||
      site?.project.description ||
      `Every update shipped to ${name}.`;
    // Canonicalize to the site's one base (primary domain › subdomain › self).
    const project = site?.project;
    const url = sitePageUrl(params.projectId, 'changelog', loaderData?.lang, {
      primaryDomain: project?.primaryDomain,
      slug: project?.slug,
      requestOrigin: loaderData?.siteOrigin,
    });
    return {
      meta: [{ title: `Changelog — ${name}` }, { name: 'description', content: description }],
      links: [
        { rel: 'canonical', href: url },
        { rel: 'alternate', type: 'application/rss+xml', title: `${name} changelog`, href: changelogFeedUrl(url) },
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
const formatDate = (value: string | null, lang?: string): string => {
  const date = parse(value);
  return date ? date.toLocaleDateString(lang || undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
};
const monthKey = (value: string | null): string => {
  const date = parse(value);
  return date ? `${date.getFullYear()}-${date.getMonth()}` : 'unknown';
};
const monthLabel = (value: string | null, lang?: string): string => {
  const date = parse(value);
  return date ? date.toLocaleDateString(lang || undefined, { year: 'numeric', month: 'long' }) : '';
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
  // The active language comes from the parent site route's ?lang= search param.
  const { lang } = useSearch({ strict: false }) as { lang?: string };
  const t = siteT(lang);
  const { entries } = Route.useLoaderData();
  const groups = groupByMonth(entries, lang);

  return (
    // Horizontal gutters come from the route's content wrapper (px-4 sm:px-6).
    <div className="mx-auto min-h-[560px] max-w-[820px] py-9 lg:py-12">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </span>
        <h1 className="font-bold text-3xl tracking-tight">{t('changelog')}</h1>
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
                          {entry.date ? <span>{formatDate(entry.date, lang)}</span> : null}
                          <span aria-hidden>·</span>
                          <span>
                            {entry.pages} {entry.pages === 1 ? t('changelogPage') : t('changelogPages')}
                          </span>
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
