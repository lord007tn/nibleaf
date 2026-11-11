import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { DataList, DataListEmpty, DataListItem, DataListSkeleton, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { TooltipButton } from '@nibleaf/design-system/components/ui/tooltip-button';
import { useLocale } from '@nibleaf/i18n/react';
import { FileText, Folder, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Language } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { type PageTrashItem, usePageTrash, usePurgePageTrash } from '@/hooks/api/page-trash';
import { localeTag, useFormatters } from '@/lib/format';
import { useRestoreFromTrash } from './use-delete-page';

const DAY_MS = 24 * 60 * 60 * 1000;
/** From this many days left, the countdown reads as a warning. */
const WARN_DAYS = 3;

/** Whole days until an item is deleted forever (0 on its last day). */
export const daysLeft = (expiresAt: string, now = Date.now()) => Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / DAY_MS));

export interface PageTrashProps {
  projectId: string;
  /** The page tree's branch; Trash lists the default branch when omitted. */
  branchId?: string;
  /** The site's languages, to name an item's language when there are several. */
  languages: Pick<Language, 'id' | 'label'>[];
  /** Viewers see Trash but cannot restore or delete. */
  canEdit: boolean;
}

/**
 * The Trash dialog: what was deleted on this branch in the last 30 days, with
 * Restore and Delete forever. Loaded on demand by `PageTrashButton`, so its
 * list, design-system pieces and mutations never ship with the page tree.
 */
export default function PageTrashDialog({
  projectId,
  branchId,
  languages,
  canEdit,
  open,
  onOpenChange,
}: PageTrashProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { locale, t } = useLocale();
  /** Whole days from now, said the locale's way (“in 3 days”, “tomorrow”, “today”). */
  const relativeDays = (days: number) => new Intl.RelativeTimeFormat(localeTag(locale), { numeric: 'auto' }).format(days, 'day');
  const fmt = useFormatters();
  // Read (and purged of expired items) only while the dialog is open.
  const trash = usePageTrash(projectId, branchId, open);
  const { restore } = useRestoreFromTrash(projectId);
  const purge = usePurgePageTrash(projectId);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [purging, setPurging] = useState<PageTrashItem | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const languageName = (id: string) => (languages.length > 1 ? languages.find((language) => language.id === id)?.label : undefined);
  const titleOf = (item: Pick<PageTrashItem, 'title'>) => item.title.trim() || t('editor.untitled');
  const viewOnly = canEdit ? undefined : t('access.viewOnly.action');

  const body = trash.isPending ? (
    <DataListSkeleton bordered loadingLabel={t('common.loading')} rows={3} />
  ) : trash.isError ? (
    <DataListEmpty bordered>
      <EmptyState
        action={
          <Button loading={trash.isFetching} onClick={() => void trash.refetch()} size="sm" variant="outline">
            {t('common.retry')}
          </Button>
        }
        icon={<Trash2 />}
        title={t('editor.trash.loadError')}
      />
    </DataListEmpty>
  ) : trash.data.length === 0 ? (
    <DataListEmpty bordered>
      <EmptyState icon={<Trash2 />} title={t('editor.trash.emptyTitle')} />
    </DataListEmpty>
  ) : (
    <DataList aria-label={t('editor.trash.title')} bordered className="max-h-[min(60vh,28rem)] overflow-y-auto">
      {trash.data.map((item) => {
        const title = titleOf(item);
        const left = daysLeft(item.expiresAt);
        const when = fmt.relativeTime(item.deletedAt);
        const language = languageName(item.languageId);
        return (
          <DataListItem
            badges={
              <StatusBadge size="sm" tone={left <= WARN_DAYS ? 'warning' : 'neutral'}>
                {t('editor.trash.expires', { when: relativeDays(left) })}
              </StatusBadge>
            }
            data-testid="page-trash-item"
            key={item.id}
            leading={
              <span aria-hidden className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">
                {item.kind === 'GROUP' ? <Folder className="size-4" /> : <FileText className="size-4" />}
              </span>
            }
            meta={
              <>
                <span>{t('dashboard.pages', fmt.count(item.pageCount))}</span>
                <span>{item.deletedBy ? t('editor.trash.deletedBy', { name: item.deletedBy.name || item.deletedBy.email, when }) : when}</span>
                {language ? <span>{language}</span> : null}
              </>
            }
            title={<bdi>{title}</bdi>}
            // Restore and the menu move under the details on a phone.
            trailingLayout="stack"
            trailing={
              <>
                <TooltipButton
                  disabledReason={viewOnly}
                  focusableWhenDisabled
                  loading={restoring === item.id}
                  onClick={async () => {
                    if (restoring) return;
                    setRestoring(item.id);
                    try {
                      await restore(item.id, title);
                    } finally {
                      setRestoring(null);
                    }
                  }}
                  size="sm"
                  variant="outline"
                >
                  <RotateCcw aria-hidden className="size-3.5" />
                  {t('editor.trash.restore')}
                </TooltipButton>
                <RowActions label={t('editor.pageActions', { title })}>
                  <RowActionsItem
                    destructive
                    disabledReason={viewOnly}
                    icon={<Trash2 aria-hidden />}
                    onSelect={() => {
                      setPurging(item);
                      setPurgeOpen(true);
                    }}
                  >
                    {t('editor.trash.deleteForever')}
                  </RowActionsItem>
                </RowActions>
              </>
            }
          />
        );
      })}
    </DataList>
  );

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="max-w-xl" data-testid="page-trash-dialog">
          <DialogHeader>
            <DialogTitle>{t('editor.trash.title')}</DialogTitle>
            <DialogDescription>{t('editor.trash.description')}</DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('editor.trash.deleteForever')}
        description={purging ? t('editor.trash.deleteForeverBody', { pages: t('dashboard.pages', fmt.count(purging.pageCount)) }) : undefined}
        destructive
        errorMessage={(error) => friendlyErrorMessage(t, error, 'editor.deleteFailed')}
        fallbackErrorMessage={t('editor.deleteFailed')}
        onConfirm={async () => {
          if (purging) await purge.mutateAsync(purging.id);
        }}
        onOpenChange={setPurgeOpen}
        open={purgeOpen}
        title={t('editor.trash.deleteForeverTitle', { title: purging ? titleOf(purging) : '' })}
      />
    </>
  );
}
