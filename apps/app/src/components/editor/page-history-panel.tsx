import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { DataList, DataListItem, DataListSkeleton } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@nibleaf/design-system/components/ui/sheet';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { Tabs, TabsList, TabsTrigger } from '@nibleaf/design-system/components/ui/tabs';
import { TooltipButton } from '@nibleaf/design-system/components/ui/tooltip-button';
import { isRtl } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import type { PageHistoryEntry } from '@nibleaf/shared/page-history';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { pageHistoryComparisonQueryOptions, pageHistoryQueryOptions, restorePageHistory } from '@/hooks/api/page-history';
import { queryKeys } from '@/hooks/api/query-keys';
import type { Page } from '@/hooks/api/types';
import { isEditorRevisionConflict } from './editor-draft';

export function PageHistoryPanel({
  projectId,
  page,
  canRestore,
  onClose,
  onRestored,
}: {
  projectId: string;
  page: Page;
  canRestore: boolean;
  onClose: () => void;
  onRestored: (page: Page) => void;
}) {
  const { t, locale } = useLocale();
  const qc = useQueryClient();
  const [source, setSource] = useState<'revision' | 'published'>('revision');
  const [selected, setSelected] = useState<PageHistoryEntry | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const history = useInfiniteQuery(pageHistoryQueryOptions(projectId, page.id, source));
  const comparison = useQuery(
    pageHistoryComparisonQueryOptions(projectId, page.id, selected ? { source: selected.source, entryId: selected.id } : null, page.updatedAt),
  );
  const entries = history.data?.pages.flatMap((batch) => batch.entries) ?? [];
  const compared = comparison.data;
  const unchanged = compared?.diff.status === 'equal' && compared.title.before === compared.title.after;
  const disabledReason = !canRestore
    ? t('editor.history.viewOnly')
    : !selected || !compared || comparison.isFetching
      ? t('editor.history.pick')
      : unchanged
        ? t('editor.history.noChanges')
        : undefined;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open && !restoring) onClose();
        }}
        disablePointerDismissal={restoring}
      >
        <SheetContent
          side={isRtl(locale) ? 'left' : 'right'}
          showCloseButton={!restoring}
          className="gap-0 data-[side=left]:w-full data-[side=right]:w-full data-[side=left]:sm:max-w-3xl data-[side=right]:sm:max-w-3xl"
          dir={isRtl(locale) ? 'rtl' : 'ltr'}
        >
          <SheetHeader className="border-b pe-14">
            <SheetTitle>{t('editor.history.title')}</SheetTitle>
            <SheetDescription>{t('editor.history.description')}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            <Tabs
              value={source}
              onValueChange={(value) => {
                setSource(value as typeof source);
                setSelected(null);
              }}
            >
              <TabsList className="mb-4 h-auto w-full flex-wrap">
                <TabsTrigger value="revision" className="min-h-11 flex-1">
                  {t('editor.history.revisions')}
                </TabsTrigger>
                <TabsTrigger value="published" className="min-h-11 flex-1">
                  {t('editor.history.published')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {history.isPending ? (
              <DataListSkeleton loadingLabel={t('common.loading')} rows={3} bordered />
            ) : history.isError ? (
              <EmptyState title={t('editor.history.error')} action={<Button onClick={() => void history.refetch()}>{t('common.retry')}</Button>} />
            ) : entries.length === 0 ? (
              <EmptyState icon={<History />} title={t('editor.history.empty')} description={t('editor.history.emptyDescription')} />
            ) : (
              <DataList bordered aria-label={t(source === 'revision' ? 'editor.history.revisions' : 'editor.history.published')}>
                {entries.map((entry) => (
                  <DataListItem
                    key={entry.id}
                    className={selected?.id === entry.id ? 'bg-muted/50' : undefined}
                    title={<span dir="auto">{entry.title}</span>}
                    badges={
                      <StatusBadge tone={entry.source === 'published' ? 'success' : 'neutral'}>
                        {entry.source === 'published'
                          ? t('editor.history.version', { version: entry.version ?? 0 })
                          : t(entry.reason === 'before-restore' ? 'editor.history.beforeRestore' : 'editor.history.autosave')}
                      </StatusBadge>
                    }
                    description={<span>{entry.author ?? t('editor.history.unknownAuthor')}</span>}
                    meta={
                      <>
                        <time dateTime={entry.createdAt}>{date(entry.createdAt)}</time>
                        <span>{t('editor.history.bytes', { bytes: new Intl.NumberFormat(locale).format(entry.contentBytes) })}</span>
                      </>
                    }
                    trailing={
                      <TooltipButton
                        tooltip={t('editor.history.compare')}
                        variant={selected?.id === entry.id ? 'secondary' : 'outline'}
                        className="min-h-11"
                        aria-pressed={selected?.id === entry.id}
                        onClick={() => setSelected(entry)}
                      >
                        {t('editor.history.compare')}
                      </TooltipButton>
                    }
                  />
                ))}
              </DataList>
            )}
            {history.hasNextPage ? (
              <Button
                variant="outline"
                className="mt-3 min-h-11 w-full"
                loading={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {t('editor.history.more')}
              </Button>
            ) : null}
            {selected ? (
              <section className="mt-6 min-w-0" aria-label={t('editor.history.diff')} aria-live="polite">
                <h3 className="font-medium text-sm">{t('editor.history.diff')}</h3>
                <p className="mt-1 text-muted-foreground text-xs">{t('editor.history.diffDirection')}</p>
                {comparison.isPending || comparison.isFetching ? (
                  <Skeleton className="mt-3 h-48 w-full" />
                ) : comparison.isError ? (
                  <EmptyState
                    title={t('editor.history.error')}
                    action={<Button onClick={() => void comparison.refetch()}>{t('common.retry')}</Button>}
                  />
                ) : compared ? (
                  <>
                    {compared.title.before !== compared.title.after ? (
                      <div className="mt-3 rounded-lg border p-3 text-sm">
                        <p className="break-words" dir="auto">
                          − {compared.title.before}
                        </p>
                        <p className="break-words" dir="auto">
                          + {compared.title.after}
                        </p>
                      </div>
                    ) : null}
                    {compared.diff.status === 'too-large' ? (
                      <EmptyState title={t('editor.history.tooLarge')} />
                    ) : unchanged ? (
                      <EmptyState title={t('editor.history.noChanges')} />
                    ) : (
                      <section
                        className="mt-3 max-h-[45vh] overflow-auto whitespace-pre rounded-lg border bg-muted/20 py-3 font-mono text-xs leading-6"
                        dir="ltr"
                        aria-label={t('editor.history.diff')}
                      >
                        {compared.diff.lines.map((line, index) => (
                          <div
                            // biome-ignore lint/suspicious/noArrayIndexKey: immutable server diff lines have positional identity
                            key={index}
                            className={
                              line.kind === 'added'
                                ? 'bg-emerald-500/10 px-3'
                                : line.kind === 'removed'
                                  ? 'bg-red-500/10 px-3'
                                  : 'px-3 text-muted-foreground'
                            }
                          >
                            <span aria-hidden>{line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}</span>
                            <bdi>{line.text || ' '}</bdi>
                          </div>
                        ))}
                      </section>
                    )}
                  </>
                ) : null}
              </section>
            ) : (
              <p className="py-6 text-center text-muted-foreground text-sm">{t('editor.history.pick')}</p>
            )}
          </div>
          <div className="border-t p-4">
            <TooltipButton className="min-h-11 w-full" disabledReason={disabledReason} onClick={() => setConfirming(true)}>
              {t('editor.history.restore')}
            </TooltipButton>
          </div>
        </SheetContent>
      </Sheet>
      <ActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('editor.history.restore')}
        description={t('editor.history.confirm')}
        confirmLabel={t('editor.history.restore')}
        cancelLabel={t('common.cancel')}
        fallbackErrorMessage={t('editor.history.error')}
        errorMessage={(error) =>
          isEditorRevisionConflict(error)
            ? t('editor.conflict.body')
            : error instanceof ApiResponseError && error.reason === 'history_snapshot_too_large'
              ? t('editor.history.snapshotTooLarge')
              : undefined
        }
        onConfirm={async () => {
          if (!selected || !compared || !canRestore) return;
          setRestoring(true);
          try {
            const saved = await restorePageHistory(projectId, page.id, { source: selected.source, entryId: selected.id }, compared.expectedUpdatedAt);
            await qc.cancelQueries({ queryKey: queryKeys.pages.detail(projectId, page.id), exact: true });
            qc.setQueryData(queryKeys.pages.detail(projectId, page.id), saved);
            onRestored(saved);
            void qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
            void qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
            toast.success(t('editor.history.restored'));
          } finally {
            setRestoring(false);
          }
        }}
      />
    </>
  );
}
