import { createFileRoute } from '@tanstack/react-router';
import { useSiteChangelog } from '@/hooks/api';

export const Route = createFileRoute('/sites/$projectId/changelog')({
  component: SiteChangelog,
});

const formatDate = (value: string | null): string => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

function SiteChangelog() {
  const { projectId } = Route.useParams();
  const { data, isPending } = useSiteChangelog(projectId);

  return (
    <div className="mx-auto min-h-[560px] max-w-[760px] px-8 py-12">
      <h1 className="font-bold text-3xl tracking-tight">Changelog</h1>
      <p className="mt-1.5 text-muted-foreground text-sm">Every update shipped to these docs.</p>

      <div className="mt-9">
        {isPending ? (
          <ChangelogSkeleton />
        ) : !data || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No releases yet.</p>
        ) : (
          data.map((entry) => (
            <div className="grid grid-cols-[120px_1fr] gap-7 pb-8" key={entry.version}>
              <div className="pt-0.5">
                <div className="font-mono font-bold text-base text-foreground">v{entry.version}</div>
                {entry.date ? <div className="mt-1 text-muted-foreground text-xs">{formatDate(entry.date)}</div> : null}
              </div>
              <div className="relative border-border border-s ps-7">
                <span className="absolute top-1 size-2.5 rounded-full bg-primary" style={{ insetInlineStart: -5 }} />
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary text-xs">Release</span>
                </div>
                <div className="font-semibold text-foreground text-lg tracking-tight">{entry.title}</div>
                <div className="mt-1.5 text-muted-foreground text-sm">
                  {entry.pages} {entry.pages === 1 ? 'page' : 'pages'}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ChangelogSkeleton() {
  return (
    <div className="animate-pulse">
      {[0, 1, 2, 3].map((row) => (
        <div className="grid grid-cols-[120px_1fr] gap-7 pb-8" key={row}>
          <div className="pt-0.5">
            <div className="h-4 w-12 rounded bg-muted" />
            <div className="mt-2 h-3 w-20 rounded bg-muted" />
          </div>
          <div className="border-border border-s ps-7">
            <div className="h-5 w-16 rounded-full bg-muted" />
            <div className="mt-3 h-5 w-48 rounded bg-muted" />
            <div className="mt-2 h-3 w-16 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
