import { createFileRoute, useSearch } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useSiteChangelog } from '@/hooks/api';
import type { ChangelogEntry } from '@/hooks/api/types';
import { siteT } from '@/lib/site-i18n';

export const Route = createFileRoute('/sites/$projectId/changelog')({
  component: SiteChangelog,
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
  const { projectId } = Route.useParams();
  // The active language comes from the parent site route's ?lang= search param.
  const { lang } = useSearch({ strict: false }) as { lang?: string };
  const t = siteT(lang);
  const { data, isPending } = useSiteChangelog(projectId);
  const groups = groupByMonth(data ?? [], lang);

  return (
    <div className="mx-auto min-h-[560px] max-w-[820px] px-8 py-12">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </span>
        <h1 className="font-bold text-3xl tracking-tight">{t('changelog')}</h1>
      </div>
      <p className="mt-2 text-muted-foreground text-sm">{t('changelogSubtitle')}</p>

      <div className="mt-10">
        {isPending ? (
          <ChangelogSkeleton />
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('changelogEmpty')}</p>
        ) : (
          <div className="space-y-10">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="mb-4 font-semibold text-[11px] text-muted-foreground/80 uppercase tracking-wider">{group.label}</h2>
                <div className="space-y-2.5">
                  {group.entries.map((entry) => (
                    <article
                      key={entry.version}
                      className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-border/80"
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

function ChangelogSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      {[0, 1].map((section) => (
        <div key={section}>
          <div className="mb-4 h-3 w-24 rounded bg-muted" />
          <div className="space-y-2.5">
            {[0, 1].map((row) => (
              <div className="flex items-start gap-4 rounded-xl border border-border p-4" key={row}>
                <div className="h-11 w-14 shrink-0 rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-muted" />
                  <div className="h-3 w-32 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

