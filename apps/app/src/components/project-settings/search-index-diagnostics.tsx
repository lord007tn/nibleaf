import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton, SkeletonStatTile } from '@nibleaf/design-system/components/ui/skeleton';
import { getLocale } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { SearchIndexDiagnosticsResult } from '@nibleaf/validators';
import { ChevronLeft, ChevronRight, Database, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { useCreateProjectSearchReindex, useProjectSearchIndexDiagnostics } from '@/hooks/api';
import { localeTag } from '@/lib/format';

const healthVariant = (health: string) => {
  if (health === 'ready') return 'secondary' as const;
  if (health === 'failed') return 'destructive' as const;
  return 'outline' as const;
};

const formatCompletedAt = (value: string) =>
  new Intl.DateTimeFormat(localeTag(getLocale()), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function SearchIndexDiagnostics({ projectId }: { projectId: string }) {
  const t = useT();
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors.at(-1);
  const diagnostics = useProjectSearchIndexDiagnostics(projectId, cursor);
  const reindex = useCreateProjectSearchReindex(projectId);

  // A failure is toasted by the hook (meta.errorMessage).
  const createReindex = () =>
    reindex.mutate(undefined, {
      onSuccess: () => {
        setCursors([undefined]);
        toast.success(t('settings.search.diagnostics.reindexQueued'));
      },
    });

  return (
    <section className="mt-9 border-border border-t pt-8" data-testid="search-index-diagnostics">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            <h3 className="font-semibold text-base">{t('settings.search.diagnostics.title')}</h3>
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] text-muted-foreground leading-relaxed">{t('settings.search.diagnostics.description')}</p>
        </div>
        <Button
          className="h-9 shrink-0"
          disabled={
            !diagnostics.data ||
            diagnostics.data.availability.reason === 'not_configured' ||
            diagnostics.data.availability.reason === 'not_published' ||
            diagnostics.data.health === 'indexing'
          }
          loading={reindex.isPending}
          loadingText={t('settings.search.diagnostics.reindexing')}
          onClick={createReindex}
          type="button"
        >
          <RefreshCw className="size-4" />
          {t('settings.search.diagnostics.reindex')}
        </Button>
      </div>

      {diagnostics.isPending ? <DiagnosticsSkeleton /> : null}
      {diagnostics.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t('settings.search.diagnostics.errorTitle')}</AlertTitle>
          <AlertDescription>
            {t('settings.search.diagnostics.errorBody')}
            <Button className="ms-2 h-auto p-0" onClick={() => diagnostics.refetch()} type="button" variant="link">
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {diagnostics.data ? <DiagnosticsContent data={diagnostics.data} cursors={cursors} setCursors={setCursors} /> : null}
    </section>
  );
}

function DiagnosticsContent({
  data,
  cursors,
  setCursors,
}: {
  data: SearchIndexDiagnosticsResult;
  cursors: Array<string | undefined>;
  setCursors: (cursors: Array<string | undefined>) => void;
}) {
  const t = useT();
  if (data.availability.reason) {
    const reason =
      data.availability.reason === 'not_published'
        ? t('settings.search.diagnostics.notPublished')
        : data.availability.reason === 'not_configured'
          ? t('settings.search.diagnostics.notConfigured')
          : t('settings.search.diagnostics.providerUnavailable');
    return (
      <Alert variant="warning">
        <TriangleAlert />
        <AlertTitle>{t('settings.search.diagnostics.unavailableTitle')}</AlertTitle>
        <AlertDescription>{reason}</AlertDescription>
      </Alert>
    );
  }

  const healthLabel =
    data.health === 'ready'
      ? t('settings.search.diagnostics.health.ready')
      : data.health === 'indexing'
        ? t('settings.search.diagnostics.health.indexing')
        : data.health === 'stale'
          ? t('settings.search.diagnostics.health.stale')
          : data.health === 'failed'
            ? t('settings.search.diagnostics.health.failed')
            : data.health === 'empty'
              ? t('settings.search.diagnostics.health.empty')
              : t('settings.search.diagnostics.health.unavailable');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm">{t('settings.search.diagnostics.healthLabel')}</span>
        </div>
        <Badge variant={healthVariant(data.health)}>{healthLabel}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label={t('settings.search.diagnostics.chunks')} value={data.corpus.chunks} />
        <Metric label={t('settings.search.diagnostics.pages')} value={data.corpus.pages} />
        <Metric label={t('settings.search.diagnostics.languages')} value={data.corpus.languages.length} />
        <Metric label={t('settings.search.diagnostics.versions')} value={data.corpus.versions.length} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <DetailCard title={t('settings.search.diagnostics.indexTitle')}>
          <Detail label={t('settings.search.diagnostics.revision')} value={data.index.revisionId ?? t('settings.search.diagnostics.unknown')} />
          <Detail label={t('settings.search.diagnostics.schema')} value={data.index.schemaVersion} />
          <Detail label={t('settings.search.diagnostics.model')} value={data.index.embeddingModel} />
          <Detail label={t('settings.search.diagnostics.runtime')} value={data.runtime} />
        </DetailCard>
        <DetailCard title={t('settings.search.diagnostics.distributionTitle')}>
          <Detail
            label={t('settings.search.diagnostics.languages')}
            value={data.corpus.languages.map((item) => `${item.code} · ${item.count}`).join(', ') || t('settings.search.diagnostics.none')}
          />
          <Detail
            label={t('settings.search.diagnostics.versions')}
            value={data.corpus.versions.map((item) => `${item.slug} · ${item.count}`).join(', ') || t('settings.search.diagnostics.none')}
          />
          <Detail
            label={t('settings.search.diagnostics.lastRun')}
            value={data.latestRun?.completedAt ? formatCompletedAt(data.latestRun.completedAt) : t('settings.search.diagnostics.none')}
          />
          {data.corpus.distributionTruncated.languages || data.corpus.distributionTruncated.versions ? (
            <p className="text-muted-foreground text-xs">{t('settings.search.diagnostics.distributionBounded')}</p>
          ) : null}
        </DetailCard>
      </div>

      {data.issues.staleCount > 0 || data.issues.failedCount > 0 ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>{t('settings.search.diagnostics.issuesTitle')}</AlertTitle>
          <AlertDescription>
            {t('settings.search.diagnostics.issuesBody', { stale: data.issues.staleCount, failed: data.issues.failedCount })}
          </AlertDescription>
        </Alert>
      ) : null}

      {data.issues.items.length > 0 ? (
        <div className="rounded-lg border bg-card">
          <div className="border-border border-b px-4 py-3">
            <p className="font-medium text-sm">{t('settings.search.diagnostics.issueSamplesTitle')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.search.diagnostics.privacy')}</p>
          </div>
          <div className="divide-y">
            {data.issues.items.map((item) => (
              <div
                className="grid gap-1 px-4 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                key={`${item.pageId}-${item.ordinal}-${item.status}`}
              >
                <div className="min-w-0">
                  <p className="truncate font-mono font-medium" dir="ltr">
                    {item.pageId}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">{t('settings.search.diagnostics.ordinal', { ordinal: item.ordinal })}</p>
                </div>
                <span className="text-muted-foreground" dir="ltr">
                  {item.language} · {item.versionSlug}
                </span>
                <Badge variant={item.status === 'failed' ? 'destructive' : 'outline'}>
                  {item.errorCode
                    ? t('settings.search.diagnostics.issueCode', { code: item.errorCode })
                    : item.status === 'failed'
                      ? t('settings.search.diagnostics.issueFailed')
                      : t('settings.search.diagnostics.issueStale')}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border bg-card">
        <div className="border-border border-b px-4 py-3">
          <p className="font-medium text-sm">{t('settings.search.diagnostics.samplesTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.search.diagnostics.privacy')}</p>
        </div>
        {data.samples.items.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground text-sm">{t('settings.search.diagnostics.noSamples')}</p>
        ) : (
          <div className="divide-y">
            {data.samples.items.map((item) => (
              <div className="grid gap-1 px-4 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4" key={item.pointId}>
                <div className="min-w-0">
                  <p className="truncate font-mono font-medium" dir="ltr">
                    {item.pageId}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">{t('settings.search.diagnostics.ordinal', { ordinal: item.ordinal })}</p>
                </div>
                <span className="text-muted-foreground" dir="ltr">
                  {item.language}
                </span>
                <Badge dir="ltr" variant="outline">
                  {item.versionSlug}
                </Badge>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-border border-t px-4 py-3">
          <Button
            className="h-9"
            disabled={cursors.length === 1}
            onClick={() => setCursors(cursors.slice(0, -1))}
            size="sm"
            type="button"
            variant="outline"
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
            {t('settings.search.diagnostics.previous')}
          </Button>
          <Button
            className="h-9"
            disabled={!data.samples.nextCursor}
            onClick={() => setCursors([...cursors, data.samples.nextCursor ?? undefined])}
            size="sm"
            type="button"
            variant="outline"
          >
            {t('settings.search.diagnostics.next')}
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  const t = useT();
  return (
    <div className="rounded-lg border bg-card p-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-xl tabular-nums">{value ?? t('settings.search.diagnostics.unknown')}</p>
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-3 font-medium text-sm">{title}</p>
      <dl className="space-y-2.5">{children}</dl>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all text-end font-mono" dir="ltr">
        {value}
      </dd>
    </div>
  );
}

/** The health row, the four counts and the two detail cards, in place. */
function DiagnosticsSkeleton() {
  const t = useT();
  return (
    <div aria-busy="true" className="space-y-5">
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      <div aria-hidden className="space-y-5">
        <Skeleton className="h-12 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {['chunks', 'pages', 'languages', 'versions'].map((key) => (
            <SkeletonStatTile key={key} />
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
