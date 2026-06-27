import { createFileRoute, useSearch } from '@tanstack/react-router';
import { useSiteChangelog } from '@/hooks/api';
import { siteT } from '@/lib/site-i18n';

export const Route = createFileRoute('/sites/$projectId/changelog')({
  component: SiteChangelog,
});

const formatDate = (value: string | null, lang?: string): string => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(lang || undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

function SiteChangelog() {
  const { projectId } = Route.useParams();
  // The active language comes from the parent site route's ?lang= search param.
  const { lang } = useSearch({ strict: false }) as { lang?: string };
  const t = siteT(lang);
  const { data, isPending } = useSiteChangelog(projectId);

  return (
    <div className="mx-auto min-h-[560px] max-w-[760px] px-8 py-12">
      <h1 className="font-bold text-3xl tracking-tight">{t('changelog')}</h1>
      <p className="mt-1.5 text-muted-foreground text-sm">{t('changelogSubtitle')}</p>

      <div className="mt-10">
        {isPending ? (
          <ChangelogSkeleton />
        ) : !data || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('changelogEmpty')}</p>
        ) : (
          <div className="relative ms-1.5 border-border border-s ps-8">
            {data.map((entry) => (
              <div className="relative pb-10 last:pb-0" key={entry.version}>
                {/* timeline node sitting on the rail */}
                <span
                  className="absolute top-1.5 grid size-3.5 place-items-center rounded-full border-[3px] border-background bg-primary"
                  style={{ insetInlineStart: '-2.45rem' }}
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono font-semibold text-foreground text-lg">v{entry.version}</span>
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-[11px] text-primary uppercase tracking-wide">
                    {t('changelogRelease')}
                  </span>
                  {entry.date ? <span className="text-muted-foreground text-xs">{formatDate(entry.date, lang)}</span> : null}
                </div>
                <div className="mt-3 rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="font-semibold text-base text-foreground tracking-tight">{entry.title}</div>
                  <div className="mt-1 text-muted-foreground text-sm">
                    {entry.pages} {entry.pages === 1 ? t('changelogPage') : t('changelogPages')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChangelogSkeleton() {
  return (
    <div className="relative ms-1.5 animate-pulse border-border border-s ps-8">
      {[0, 1, 2, 3].map((row) => (
        <div className="pb-10" key={row}>
          <div className="flex items-center gap-3">
            <div className="h-5 w-10 rounded bg-muted" />
            <div className="h-4 w-16 rounded-full bg-muted" />
            <div className="h-3 w-20 rounded bg-muted" />
          </div>
          <div className="mt-3 h-16 rounded-xl bg-muted" />
        </div>
      ))}
    </div>
  );
}
