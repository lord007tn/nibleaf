import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { DataList, DataListItem, DataListSkeleton } from '@nibleaf/design-system/components/ui/data-list';
import { PageContainer } from '@nibleaf/design-system/components/ui/page-container';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { TooltipButton } from '@nibleaf/design-system/components/ui/tooltip-button';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { QueryErrorState } from '@/components/query-error-state';
import { type PublishChange, type PublishChangeSummary, usePublishHistoryDetail } from '@/hooks/api/publish-history';
import type { Deployment } from '@/hooks/api/types';
import { useFormatters } from '@/lib/format';
import { publishFailureDetails } from '../project/deploy-pipeline';
import { canRestoreState, PublishStatusBadge, publishState, useLiveVersionId } from './publish-status';
import { useRestoreReason, useRestoreVersion } from './restore-version';

const CHANGE_LABEL: Record<PublishChange['status'], MessageKey> = {
  added: 'publish.added',
  modified: 'publish.modified',
  removed: 'publish.removed',
};
const CHANGE_TONE = { added: 'success', modified: 'info', removed: 'danger' } as const;

/** One version of the site: who published it, what it changed against the
 *  version before it, and (for an older live version) Restore. */
export default function PublishVersionPage() {
  const { projectId, deploymentId } = useParams({ from: '/app/projects/$projectId/publishes/$deploymentId' });
  const t = useT();
  const fmt = useFormatters();
  const detail = usePublishHistoryDetail(projectId, deploymentId);
  const liveId = useLiveVersionId(projectId, detail.data?.live);
  const restoreReason = useRestoreReason(projectId);
  const restore = useRestoreVersion(projectId);
  const deployment = detail.data?.deployment;
  const state = deployment ? publishState(deployment, deployment.id === liveId) : null;
  const back = (
    <Link
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      params={{ projectId }}
      to="/app/projects/$projectId/publishes"
    >
      <ArrowLeft aria-hidden className="size-3.5 rtl:rotate-180" />
      {t('publishes.title')}
    </Link>
  );

  if (detail.isPending) {
    return (
      <PageContainer aria-busy="true">
        <PageHeader back={back} title={<Skeleton className="h-6 w-32" />} />
        <DataListSkeleton bordered loadingLabel={t('common.loading')} rows={4} withLeading={false} />
      </PageContainer>
    );
  }
  if (!deployment || !state) {
    return (
      <PageContainer>
        <PageHeader back={back} title={t('publishes.title')} />
        <QueryErrorState onRetry={() => void detail.refetch()} retrying={detail.isFetching} />
      </PageContainer>
    );
  }

  const failures = deployment.status === 'FAILED' ? publishFailureDetails(deployment as Pick<Deployment, 'error' | 'errorDetails'>) : [];
  const at = deployment.completedAt ?? deployment.createdAt;
  return (
    <PageContainer>
      <PageHeader
        actions={
          canRestoreState(state) ? (
            <TooltipButton
              disabledReason={deployment.snapshotAvailable ? restoreReason : t('publishes.noSnapshot')}
              onClick={() => restore.request(deployment)}
              variant="outline"
            >
              <RotateCcw aria-hidden className="size-3.5" />
              {t('publishes.restore')}
            </TooltipButton>
          ) : null
        }
        back={back}
        badge={<PublishStatusBadge state={state} />}
        description={
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            {deployment.commitMessage ? <span dir="auto">{deployment.commitMessage}</span> : null}
            <span dir="auto">{deployment.publishedBy ?? t('editor.history.unknownAuthor')}</span>
            <time dateTime={at}>{fmt.dateTime(at)}</time>
            {deployment.status === 'READY' ? <span>{t('dashboard.pages', fmt.count(deployment.pagesCount))}</span> : null}
          </span>
        }
        title={t('editor.history.version', { version: deployment.version })}
      />
      {failures.length > 0 ? (
        <Callout title={t('deploy.failedDetails')} tone="danger">
          <ul className="space-y-1">
            {failures.map((failure) => (
              <li className="break-words" dir="auto" key={failure}>
                {failure}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {detail.data?.summary?.status === 'ready' ? <ChangeSummary summary={detail.data.summary} /> : null}
      {detail.data?.summary?.status === 'unavailable' ? (
        <Callout data-testid="publish-changes-unavailable" tone="neutral">
          {t(detail.data.summary.reason === 'no_snapshot' ? 'publishes.noSnapshot' : 'publishes.tooLarge')}
        </Callout>
      ) : null}
      {restore.elements}
    </PageContainer>
  );
}

function ChangeSummary({ summary }: { summary: PublishChangeSummary }) {
  const t = useT();
  const fmt = useFormatters();
  const { totals } = summary;
  const total = totals.added + totals.modified + totals.removed;
  const headingId = 'publish-version-changes';
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-testid="publish-changes">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-semibold text-base" id={headingId}>
          {summary.previous ? t('publishes.changesSince', { version: summary.previous.version }) : t('publish.firstPublish')}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {(['added', 'modified', 'removed'] as const).map((status) =>
            totals[status] > 0 ? (
              <StatusBadge data-total={status} key={status} tone={CHANGE_TONE[status]}>
                {t(CHANGE_LABEL[status])} {fmt.number(totals[status])}
              </StatusBadge>
            ) : null,
          )}
        </div>
      </div>
      {summary.settingsChanged ? <Callout tone="info">{t('publishes.settingsChanged')}</Callout> : null}
      {total === 0 && !summary.settingsChanged ? <p className="text-muted-foreground text-sm">{t('publish.none')}</p> : null}
      {summary.changes.length > 0 ? (
        <DataList aria-labelledby={headingId} bordered>
          {summary.changes.map((change) => (
            <DataListItem
              badges={
                <StatusBadge size="sm" tone={CHANGE_TONE[change.status]}>
                  {t(CHANGE_LABEL[change.status])}
                </StatusBadge>
              }
              data-change={change.status}
              description={
                <span className="font-mono text-xs" dir="ltr">
                  {change.languageCode ? `${change.languageCode} · ` : ''}/{change.path}
                </span>
              }
              key={change.id}
              title={<span dir="auto">{change.title}</span>}
            />
          ))}
        </DataList>
      ) : null}
      {summary.truncated ? (
        <p className="text-muted-foreground text-sm" data-testid="publish-changes-truncated">
          {t('publishes.truncated', { shown: fmt.number(summary.changes.length), total: fmt.number(total) })}
        </p>
      ) : null}
    </section>
  );
}
