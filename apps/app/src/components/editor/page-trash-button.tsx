import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { usePageTrashCount } from '@/hooks/api/page-trash';
import { useFormatters } from '@/lib/format';
import type { PageTrashProps } from './page-trash-dialog';

// The dialog (its list, ActionDialog, DataList and mutations) loads the first
// time Trash is opened, never with the page tree.
const PageTrashDialog = lazy(() => import('./page-trash-dialog'));

/**
 * "Trash (n)" at the foot of the page tree. The count is a cheap read-only
 * request; the list is fetched only when the dialog opens.
 */
export function PageTrashButton(props: PageTrashProps) {
  const t = useT();
  const { number } = useFormatters();
  const [open, setOpen] = useState(false);
  // Mounted from the first open on, so closing can animate.
  const [loaded, setLoaded] = useState(false);
  const { data } = usePageTrashCount(props.projectId, props.branchId);
  return (
    <>
      <Button
        className="w-full cursor-pointer justify-start text-muted-foreground hover:text-foreground"
        data-testid="page-trash-button"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        size="sm"
        variant="ghost"
      >
        <Trash2 aria-hidden className="size-3.5" />
        <span className="truncate">{data ? t('editor.trash.button', { count: number(data.count) }) : t('editor.trash.title')}</span>
      </Button>
      {loaded ? (
        <Suspense fallback={null}>
          <PageTrashDialog {...props} onOpenChange={setOpen} open={open} />
        </Suspense>
      ) : null}
    </>
  );
}
