import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { useT } from '@nibleaf/i18n/react';
import { toast } from 'sonner';
import type { PageNode } from '@/hooks/api';
import { friendlyErrorMessage, useDeletePage } from '@/hooks/api';
import { countDescendants } from './page-tree-utils';

/**
 * Delete a page or group after a confirmation that names it and says how many
 * pages inside it go with it (the server deletes the whole subtree). There is
 * no undo yet, so the dialog says so.
 */
export function useDeletePageFlow(projectId: string, pages: PageNode[] | undefined) {
  const t = useT();
  const confirm = useConfirm();
  const deletePage = useDeletePage(projectId);

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
      onSuccess: () => {
        toast.success(t('editor.deleted', { title }));
        options?.onDeleted?.();
      },
      onError: (error) => toast.error(friendlyErrorMessage(t, error, 'editor.deleteFailed')),
    });
  };
}
