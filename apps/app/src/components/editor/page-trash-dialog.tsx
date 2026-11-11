import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { DataList, DataListEmpty, DataListItem, DataListSkeleton, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { TooltipButton } from '@nibleaf/design-system/components/ui/tooltip-button';
import { useT } from '@nibleaf/i18n/react';
import { FileText, Folder, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Language, PageTrashItem } from '@/hooks/api';
import { friendlyErrorMessage, usePageTrash, usePurgePageTrash } from '@/hooks/api';
import { useFormatters } from '@/lib/format';
import { useRestoreFromTrash } from './use-delete-page';

const DAY_MS = 24 * 60 * 60 * 1000;
/** From this many days left, the countdown reads as a warning. */
const WARN_DAYS = 3;

/** Whole days until an item is deleted forever (0 on its last day). */
export const daysLeft = (expiresAt: string, now = Date.now()) => Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / DAY_MS));

interface PageTrashProps {
  projectId: string;
  /** The page tree's branch; Trash lists the default branch when omitted. */
  branchId?: string;
  /** The site's languages, to name an item's language when there are several. */
  languages: Pick<Language, 'id' | 'label'>[];
  /** Viewers see Trash but cannot restore or delete. */
  canEdit: boolean;
}

/**
 * "Trash (n)" at the foot of the page tree. It opens a dialog listing what was
 * deleted on this branch in the last 30 days, with Restore and Delete forever.
 */
export function PageTrashButton({ projectId, branchId, languages, canEdit }: PageTrashProps) {
  const t = useT();
  const { number } = useFormatters();
  const [open, setOpen] = useState(false);
  const { data } = usePageTrash(projectId, branchId);
  return (
    <>
      <Button
        className="w-full cursor-pointer justify-start text-muted-foreground hover:text-foreground"
        data-testid="page-trash-button"
        onClick={() => setOpen(true)}
        size="sm"
        variant="ghost"
      >
        <Trash2 aria-hidden className="size-3.5" />
        <span className="truncate">{data ? t('editor.trash.button', { count: number(data.length) }) : t('editor.trash.title')}</span>
      </Button>
      <PageTrashDialog branchId={branchId} canEdit={canEdit} languages={languages} onOpenChange={setOpen} open={open} projectId={projectId} />
    </>
  );
}

export function PageTrashDialog({
  projectId,
  branchId,
  languages,
  canEdit,
  open,
  onOpenChange,
}: PageTrashProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const fmt = useFormatters();
  const trash = usePageTrash(projectId, branchId);
  const { restore } = useRestoreFromTrash(projectId);
  const purge = usePurgePageTrash(projectId);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [purging, setPurging] = useState<PageTrashItem | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const languageName = (id: string) => (languages.length > 1 ? languages.find((language) => language.id === id)?.label : undefined);
  const titleOf = (item: Pick<PageTrashItem, 'title'>) => item.title.trim() || t('editor.untitled');
  const viewOnly = canEdit ? undefined : t('access.viewOnly.action');

  const body = trash.isPending ? (
    <DataListSkeleton bordered loadingLabel={t('editor.trash.loading')} rows={3} />
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
      <EmptyState description={t('editor.trash.emptyBody')} icon={<Trash2 />} title={t('editor.trash.emptyTitle')} />
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
                {t('editor.trash.expires', { when: fmt.relativeDays(left) })}
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
                <span>
                  {item.deletedBy
                    ? t('editor.trash.deletedBy', { name: item.deletedBy.name || item.deletedBy.email, when })
                    : t('editor.trash.deletedAt', { when })}
                </span>
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
                <RowActions label={t('editor.trash.more', { title })}>
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
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} variant="outline">
              {t('editor.trash.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('editor.trash.deleteForever')}
        description={purging ? t('editor.trash.deleteForeverBody', { pages: t('dashboard.pages', fmt.count(purging.pageCount)) }) : undefined}
        destructive
        errorMessage={(error) => friendlyErrorMessage(t, error, 'editor.trash.deleteForeverFailed')}
        fallbackErrorMessage={t('editor.trash.deleteForeverFailed')}
        onConfirm={async () => {
          if (!purging) return;
          await purge.mutateAsync(purging.id);
          toast.success(t('editor.trash.deletedForever', { title: titleOf(purging) }));
        }}
        onOpenChange={setPurgeOpen}
        open={purgeOpen}
        pendingLabel={t('editor.trash.deletingForever')}
        title={t('editor.trash.deleteForeverTitle', { title: purging ? titleOf(purging) : '' })}
      />
    </>
  );
}
