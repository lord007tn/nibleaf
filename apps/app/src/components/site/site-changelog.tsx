import { siteT } from '@nibleaf/i18n/site';
import { Sparkles } from 'lucide-react';
import { useSiteReader } from '@/components/site/site-reader-context';
import type { ChangelogEntry, SiteShell } from '@/hooks/api/types';
import { localeTag } from '@/lib/format';

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

export function SiteChangelogView({ entries, site }: { entries: ChangelogEntry[]; site: SiteShell }) {
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
