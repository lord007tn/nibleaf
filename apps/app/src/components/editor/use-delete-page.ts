import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { useT } from '@nibleaf/i18n/react';
import { toast } from 'sonner';
import type { PageNode } from '@/hooks/api';
import { friendlyErrorMessage, useDeletePage } from '@/hooks/api';
import { type RestoredPage, useRestorePageTrash } from '@/hooks/api/page-trash';
import { countDescendants } from './page-tree-utils';

/** How long the delete toast (and its Undo) stays up. */
const UNDO_TOAST_MS = 10_000;

type Translate = ReturnType<typeof useT>;

/** What a restore says: plain, or why the page came back somewhere else. */
const restoredMessage = (t: Translate, title: string, restored: Pick<RestoredPage, 'page' | 'slugChanged' | 'movedToTopLevel'>) =>
  restored.movedToTopLevel || restored.slugChanged
    ? t('editor.trash.restoredAt', { title, path: restored.page.path })
    : t('editor.trash.restored', { title });

/**
 * Restore a Trash item and say how it went. Undo on the delete toast and
 * Restore in the Trash dialog share it, so both report the same way.
 */
export function useRestoreFromTrash(projectId: string) {
  const t = useT();
  const restore = useRestorePageTrash(projectId);
  return {
    pending: restore.isPending,
    restore: async (trashId: string, title: string) => {
      try {
        const restored = await restore.mutateAsync(trashId);
        toast.success(restoredMessage(t, title, restored));
        return restored;
      } catch (error) {
        toast.error(friendlyErrorMessage(t, error, 'editor.trash.restoreFailed'));
        return null;
      }
    },
  };
}

/**
 * Delete a page or group after a confirmation that names it and says how many
 * pages inside it go with it. The server moves the whole subtree to Trash for
 * 30 days, so the toast offers Undo.
 */
export function useDeletePageFlow(projectId: string, pages: PageNode[] | undefined) {
  const t = useT();
  const confirm = useConfirm();
  const deletePage = useDeletePage(projectId);
  const { restore } = useRestoreFromTrash(projectId);

  return async (node: Pick<PageNode, 'id' | 'kind' | 'title'>, options?: { beforeDelete?: () => Promise<void>; onDeleted?: () => void }) => {
    const count = countDescendants(pages ?? [], node.id);
    const title = node.title.trim() || t('editor.untitled');
    const isGroup = node.kind === 'GROUP';
    const label = t(isGroup ? 'editor.deleteGroup' : 'editor.deletePage');
    const description = isGroup
      ? count > 0
        ? t('editor.deleteGroupWithChildrenConfirm', { title, count })
        : t('editor.deleteGroupConfirm', { title })
      : count > 0
        ? t('editor.deletePageWithChildrenConfirm', { title, count })
        : t('editor.deletePageConfirm', { title });
    const ok = await confirm({ title: label, description, confirmLabel: label, destructive: true });
    if (!ok) return;
    try {
      await options?.beforeDelete?.();
    } catch {
      toast.error(t('editor.saveError'));
      return;
    }
    deletePage.mutate(node.id, {
      onSuccess: (deleted) => {
        const toastId = toast.success(t('editor.deleted', { title }), {
          duration: UNDO_TOAST_MS,
          action: {
            label: t('editor.toolbar.undo'),
            onClick: () => {
              toast.dismiss(toastId);
              void restore(deleted.trashId, title);
            },
          },
        });
        options?.onDeleted?.();
      },
      onError: (error) => toast.error(friendlyErrorMessage(t, error, 'editor.deleteFailed')),
    });
  };
}
