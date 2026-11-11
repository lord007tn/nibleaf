import { Button } from '@nibleaf/design-system/components/ui/button';
import { DataList, DataListEmpty, DataListItem, DataListSkeleton, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { PageContainer } from '@nibleaf/design-system/components/ui/page-container';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { useT } from '@nibleaf/i18n/react';
import { Link, useParams } from '@tanstack/react-router';
import { Rocket, RotateCcw } from 'lucide-react';
import { QueryErrorState } from '@/components/query-error-state';
import { type PublishHistoryItem, usePublishHistory } from '@/hooks/api/publish-history';
import { useFormatters } from '@/lib/format';
import { canRestoreState, PublishStatusBadge, publishState, useLiveVersionId } from './publish-status';
import { useRestoreReason, useRestoreVersion } from './restore-version';

/** The site's publish history: every attempt, newest first, the live one marked. */
export default function PublishesPage() {
  const { projectId } = useParams({ from: '/app/projects/$projectId/publishes/' });
  const t = useT();
  const history = usePublishHistory(projectId);
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const liveId = useLiveVersionId(projectId, history.data?.pages[0]?.live);
  const restoreReason = useRestoreReason(projectId);
  const restore = useRestoreVersion(projectId);

  return (
    <PageContainer width="wide">
      <PageHeader title={t('publishes.title')} />
      {history.isPending ? (
        <DataListSkeleton bordered loadingLabel={t('common.loading')} rows={5} withLeading={false} />
      ) : history.isError && items.length === 0 ? (
        <QueryErrorState onRetry={() => void history.refetch()} retrying={history.isFetching} />
      ) : items.length === 0 ? (
        <DataListEmpty bordered>
          <EmptyState icon={<Rocket />} title={t('overview.activity.empty')} />
        </DataListEmpty>
      ) : (
        <div className="flex flex-col gap-4">
          <DataList aria-label={t('publishes.title')} bordered data-testid="publish-history">
            {items.map((item) => (
              <PublishRow
                item={item}
                key={item.id}
                onRestore={() => restore.request(item)}
                projectId={projectId}
                restoreReason={restoreReason}
                state={publishState(item, item.id === liveId)}
              />
            ))}
          </DataList>
          {history.hasNextPage ? (
            <Button className="self-start" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()} variant="outline">
              {t('editor.history.more')}
            </Button>
          ) : null}
        </div>
      )}
      {restore.elements}
    </PageContainer>
  );
}

function PublishRow({
  item,
  projectId,
  state,
  restoreReason,
  onRestore,
}: {
  item: PublishHistoryItem;
  projectId: string;
  state: ReturnType<typeof publishState>;
  restoreReason: string | undefined;
  onRestore: () => void;
}) {
  const t = useT();
  const fmt = useFormatters();
  const message = item.commitMessage || (item.status === 'READY' ? t('overview.activity.publish') : null);
  return (
    <DataListItem
      badges={<PublishStatusBadge state={state} />}
      data-live={state === 'live' || undefined}
      data-version={item.version}
      description={message ? <span dir="auto">{message}</span> : undefined}
      meta={
        <>
          <span dir="auto">{item.publishedBy ?? t('editor.history.unknownAuthor')}</span>
          <time dateTime={item.completedAt ?? item.createdAt}>{fmt.dateTime(item.completedAt ?? item.createdAt)}</time>
          {item.status === 'READY' ? <span>{t('dashboard.pages', fmt.count(item.pagesCount))}</span> : null}
        </>
      }
      title={
        <Link
          className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          dir="ltr"
          params={{ projectId, deploymentId: item.id }}
          to="/app/projects/$projectId/publishes/$deploymentId"
        >
          v{item.version}
        </Link>
      }
      trailing={
        canRestoreState(state) ? (
          <RowActions label={t('settings.visibility.actionsFor', { name: `v${item.version}` })}>
            <RowActionsItem
              disabledReason={item.snapshotAvailable ? restoreReason : t('publishes.noSnapshot')}
              icon={<RotateCcw aria-hidden />}
              onSelect={onRestore}
            >
              {t('publishes.restore')}
            </RowActionsItem>
          </RowActions>
        ) : undefined
      }
    />
  );
}
