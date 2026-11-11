import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { DataList, DataListItem } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { TooltipButton } from '@nibleaf/design-system/components/ui/tooltip-button';
import { useT } from '@nibleaf/i18n/react';
import type { SearchIndexDiagnosticsResult } from '@nibleaf/validators';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { useFormatters } from '@/lib/format';
import type { SiteAdminState } from '@/lib/project-settings-access';
import { useReindexSearch, useSearchIndexDiagnostics } from '../api/hooks';
import {
  decisionProps,
  distributionText,
  HEALTH,
  hasIndexIssues,
  issueBadge,
  reindexDecision,
  samplePager,
  UNAVAILABLE_REASON,
} from '../model/search';

/**
 * The search index's health at the bottom of Search: its status and counts,
 * the technical details support asks for, bounded samples of issues and
 * indexed metadata (identifiers only, never content), and Reindex.
 */
export function IndexHealthSection({ projectId, status }: { projectId: string; status: SiteAdminState }) {
  const t = useT();
  // The sample pages visited, so Previous can go back; the first page has no cursor.
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const diagnostics = useSearchIndexDiagnostics(projectId, cursors.at(-1));
  const reindex = useReindexSearch(projectId);
  const action = decisionProps(reindexDecision(diagnostics.data, status));

  // A failure is toasted by the mutation (meta.errorMessage), once.
  const queueReindex = () =>
    reindex.mutate(undefined, {
      onSuccess: () => {
        setCursors([undefined]);
        toast.success(t('settings.search.diagnostics.reindexQueued'));
      },
    });

  return (
    <SettingsSection
      actions={
        <TooltipButton
          disabled={action.disabled}
          disabledReason={action.reason ? t(action.reason) : undefined}
          loading={reindex.isPending}
          loadingText={t('settings.search.diagnostics.reindexing')}
          onClick={queueReindex}
          type="button"
          variant="outline"
        >
          <RefreshCw aria-hidden />
          {t('settings.search.diagnostics.reindex')}
        </TooltipButton>
      }
      data-testid="search-index-diagnostics"
      description={t('settings.search.diagnostics.description')}
      title={t('settings.search.diagnostics.title')}
    >
      {diagnostics.data ? (
        <IndexDetails
          cursors={cursors}
          data={diagnostics.data}
          onPage={(next) => setCursors(next === 'back' ? cursors.slice(0, -1) : [...cursors, diagnostics.data?.samples.nextCursor ?? undefined])}
        />
      ) : diagnostics.isError ? (
        <SettingsSectionBody>
          <Callout
            action={
              <Button loading={diagnostics.isFetching} onClick={() => void diagnostics.refetch()} size="sm" type="button" variant="outline">
                {t('common.retry')}
              </Button>
            }
            title={t('settings.search.diagnostics.errorTitle')}
            tone="danger"
          >
            {t('settings.search.diagnostics.errorBody')}
          </Callout>
        </SettingsSectionBody>
      ) : (
        <IndexDetailsSkeleton />
      )}
    </SettingsSection>
  );
}

function IndexDetails({
  data,
  cursors,
  onPage,
}: {
  data: SearchIndexDiagnosticsResult;
  cursors: Array<string | undefined>;
  onPage: (direction: 'back' | 'forward') => void;
}) {
  const t = useT();
  const { number, dateTime } = useFormatters();
  if (data.availability.reason) {
    return (
      <SettingsSectionBody>
        <Callout title={t('settings.search.diagnostics.unavailableTitle')} tone="warning">
          {t(UNAVAILABLE_REASON[data.availability.reason])}
        </Callout>
      </SettingsSectionBody>
    );
  }

  const health = HEALTH[data.health];
  const count = (value: number | null) => (value === null ? t('settings.search.diagnostics.unknown') : number(value));
  const languages = distributionText(data.corpus.languages.map((item) => ({ key: item.code, count: item.count })));
  const versions = distributionText(data.corpus.versions.map((item) => ({ key: item.slug, count: item.count })));
  const pager = samplePager(cursors.length, data.samples.nextCursor);

  return (
    <>
      <Fact label={t('settings.search.diagnostics.healthLabel')}>
        <StatusBadge tone={health.tone}>{t(health.label)}</StatusBadge>
      </Fact>
      <Fact label={t('settings.search.diagnostics.pages')}>{count(data.corpus.pages)}</Fact>
      <Fact label={t('settings.search.diagnostics.chunks')}>{count(data.corpus.chunks)}</Fact>
      <Fact description={languages ? <bdi dir="ltr">{languages}</bdi> : undefined} label={t('settings.search.diagnostics.languages')}>
        {number(data.corpus.languages.length)}
      </Fact>
      <Fact description={versions ? <bdi dir="ltr">{versions}</bdi> : undefined} label={t('settings.search.diagnostics.versions')}>
        {number(data.corpus.versions.length)}
      </Fact>
      <Fact label={t('settings.search.diagnostics.lastRun')}>
        {data.latestRun?.completedAt ? dateTime(data.latestRun.completedAt) : t('settings.search.diagnostics.none')}
      </Fact>
      {data.corpus.distributionTruncated.languages || data.corpus.distributionTruncated.versions ? (
        <SettingsSectionBody className="text-muted-foreground text-xs">{t('settings.search.diagnostics.distributionBounded')}</SettingsSectionBody>
      ) : null}

      <SettingsSectionBody>
        <h3 className="font-medium text-sm">{t('settings.search.diagnostics.indexTitle')}</h3>
        <dl className="mt-3 grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
          <Detail label={t('settings.search.diagnostics.revision')} value={data.index.revisionId ?? t('settings.search.diagnostics.unknown')} />
          <Detail label={t('settings.search.diagnostics.schema')} value={data.index.schemaVersion} />
          <Detail label={t('settings.search.diagnostics.model')} value={data.index.embeddingModel} />
          <Detail label={t('settings.search.diagnostics.runtime')} value={data.runtime} />
        </dl>
      </SettingsSectionBody>

      {hasIndexIssues(data.issues) ? (
        <SettingsSectionBody>
          <Callout title={t('settings.search.diagnostics.issuesTitle')} tone="warning">
            {t('settings.search.diagnostics.issuesBody', { stale: data.issues.staleCount, failed: data.issues.failedCount })}
          </Callout>
        </SettingsSectionBody>
      ) : null}

      {data.issues.items.length > 0 ? (
        <>
          <SampleHeading title={t('settings.search.diagnostics.issueSamplesTitle')} />
          <DataList aria-label={t('settings.search.diagnostics.issueSamplesTitle')}>
            {data.issues.items.map((item) => {
              const badge = issueBadge(item);
              return (
                <DataListItem
                  badges={<StatusBadge tone={badge.tone}>{t(badge.label, { code: badge.code ?? '' })}</StatusBadge>}
                  description={t('settings.search.diagnostics.ordinal', { ordinal: item.ordinal })}
                  key={`${item.pageId}-${item.ordinal}-${item.status}`}
                  meta={
                    <bdi dir="ltr">
                      {item.language} · {item.versionSlug}
                    </bdi>
                  }
                  title={<PageId id={item.pageId} />}
                />
              );
            })}
          </DataList>
        </>
      ) : null}

      <SampleHeading title={t('settings.search.diagnostics.samplesTitle')} />
      {data.samples.items.length === 0 ? (
        <EmptyState headingLevel={4} title={t('settings.search.diagnostics.noSamples')} />
      ) : (
        <DataList aria-label={t('settings.search.diagnostics.samplesTitle')}>
          {data.samples.items.map((item) => (
            <DataListItem
              description={t('settings.search.diagnostics.ordinal', { ordinal: item.ordinal })}
              key={item.pointId}
              meta={
                <bdi dir="ltr">
                  {item.language} · {item.versionSlug}
                </bdi>
              }
              title={<PageId id={item.pageId} />}
            />
          ))}
        </DataList>
      )}
      {pager.canGoBack || pager.canGoForward ? (
        <SettingsSectionBody className="flex items-center justify-end gap-2 py-3">
          <Button disabled={!pager.canGoBack} onClick={() => onPage('back')} size="sm" type="button" variant="outline">
            <ChevronLeft aria-hidden className="rtl:rotate-180" />
            {t('settings.search.diagnostics.previous')}
          </Button>
          <Button disabled={!pager.canGoForward} onClick={() => onPage('forward')} size="sm" type="button" variant="outline">
            {t('settings.search.diagnostics.next')}
            <ChevronRight aria-hidden className="rtl:rotate-180" />
          </Button>
        </SettingsSectionBody>
      ) : null}
    </>
  );
}

/** One read-only fact as a settings row: the label, then the value in an `<output>` the label names. */
function Fact({ label, description, children }: { label: string; description?: ReactNode; children: ReactNode }) {
  return (
    <SettingsRow control="auto" description={description} label={label}>
      {(ids) => (
        <output aria-describedby={ids.describedBy} className="block font-medium text-sm tabular-nums" id={ids.controlId}>
          {children}
        </output>
      )}
    </SettingsRow>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-end font-mono" dir="ltr">
        {value}
      </dd>
    </>
  );
}

/** A sample list's sub-label and its privacy promise. */
function SampleHeading({ title }: { title: string }) {
  const t = useT();
  return (
    <SettingsSectionBody>
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="mt-1 text-muted-foreground text-xs">{t('settings.search.diagnostics.privacy')}</p>
    </SettingsSectionBody>
  );
}

function PageId({ id }: { id: string }) {
  return (
    <span className="break-all font-mono" dir="ltr">
      {id}
    </span>
  );
}

/** The facts rows and the details block, in place. */
function IndexDetailsSkeleton() {
  const t = useT();
  return (
    <SettingsSectionBody aria-busy="true">
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      <div aria-hidden className="flex flex-col gap-4">
        {['health', 'pages', 'chunks', 'languages', 'versions'].map((key) => (
          <div className="flex items-center justify-between gap-6" key={key}>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </SettingsSectionBody>
  );
}
