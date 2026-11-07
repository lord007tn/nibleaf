import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton, SkeletonCard, SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { FileText, FolderPlus, PanelLeftOpen, Pencil, Plus, Settings2, Trash2, TriangleAlert } from 'lucide-react';
import { ConfigSection, type ConfigSectionId } from '@/components/editor/site-config-panel';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import type { PageNode, Project } from '@/hooks/api/types';

/*
 * The editor canvas's self-contained states (everything but the open page,
 * which shares most of the route's state). The route renders exactly one of
 * them inside its single <main id="main-content"> landmark.
 */

/** Site configuration: an admin-only section, with a skeleton until permissions and the site load. */
export function ConfigCanvas({
  project,
  section,
  reportDirty,
  canManage,
  permissionsPending,
  onBackToWriting,
}: {
  canManage: boolean;
  permissionsPending: boolean;
  onBackToWriting: () => void;
  project: Project | undefined;
  section: ConfigSectionId;
  reportDirty: (source: string, dirty: boolean) => void;
}) {
  const t = useT();
  return (
    <section className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {/* A muted overline so it reads as "Site configuration › <section>"
      rather than competing with each section's own heading. */}
      <div className="border-border border-b px-6 py-3">
        <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">{t('editor.config.heading')}</span>
      </div>
      <div className="mx-auto w-full max-w-6xl px-5 pt-7 pb-32 sm:px-8">
        {!permissionsPending && !canManage ? (
          <div className="max-w-xl rounded-xl border border-border bg-card p-6">
            <p className="text-muted-foreground text-sm" role="status">
              {t('editor.config.adminOnly')}
            </p>
            <Button
              className="mt-4 min-h-11"
              onClick={(event) => {
                onBackToWriting();
                event.currentTarget.closest('main')?.focus();
              }}
              type="button"
              variant="outline"
            >
              {t('editor.config.backToWriting')}
            </Button>
          </div>
        ) : !permissionsPending && canManage && project ? (
          <div className={cn('w-full', section === 'themes' ? 'max-w-6xl' : 'max-w-4xl')}>
            <ConfigDirtyProvider report={reportDirty}>
              <ConfigSection project={project} section={section} />
            </ConfigDirtyProvider>
          </div>
        ) : (
          <div aria-busy="true" className="max-w-4xl">
            <p className="sr-only" role="status">
              {t('common.loading')}
            </p>
            <SkeletonCard />
          </div>
        )}
      </div>
    </section>
  );
}

/** The page canvas while a page opens or is created: toolbar row, then the title
 *  and first paragraphs at the editor's reading measure. `status` is announced. */
export function PageCanvasSkeleton({ status }: { status: string }) {
  return (
    <section aria-busy="true" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <p className="sr-only" role="status">
        {status}
      </p>
      <div aria-hidden className="flex min-h-12 items-center justify-end gap-2 border-border border-b px-4">
        <Skeleton className="size-8" />
        <Skeleton className="size-8" />
        <Skeleton className="size-8" />
      </div>
      <div aria-hidden className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-0 sm:py-8">
        <Skeleton className="mb-6 h-10 w-2/3" />
        <SkeletonText lines={5} />
      </div>
    </section>
  );
}

/** A selected group: what can be done with it (add a page inside, rename, settings, delete). */
export function GroupCanvas({
  group,
  addingPage,
  onAddPage,
  onRename,
  onOpenSettings,
  onDelete,
}: {
  group: PageNode;
  addingPage: boolean;
  onAddPage: () => void;
  onRename: () => void;
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <section className="grid flex-1 place-items-center px-6 text-center">
      <div className="max-w-md">
        <FolderPlus className="mx-auto size-7 text-muted-foreground" />
        <h1 className="mt-3 break-words font-semibold text-xl tracking-tight" dir="auto">
          {group.title}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('editor.groupSelectedHint')}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {group.languageId ? (
            <Button disabled={addingPage} onClick={onAddPage}>
              <Plus className="size-4" /> {t('editor.addPageInside')}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onRename}>
            <Pencil className="size-4" /> {t('editor.rename')}
          </Button>
          <Button variant="outline" onClick={onOpenSettings}>
            <Settings2 className="size-4" /> {t('editor.groupSettings')}
          </Button>
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="size-4" /> {t('editor.deleteGroup')}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The open page failed to load: say why in plain words, with Retry and a way back to the page list. */
export function PageLoadFailedCanvas({
  error,
  retrying,
  onRetry,
  sidebarCollapsed,
  onShowPages,
}: {
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
  sidebarCollapsed: boolean;
  onShowPages: () => void;
}) {
  const t = useT();
  return (
    <section className="grid flex-1 place-items-center px-6 text-center">
      <div className="max-w-sm" role="alert">
        <TriangleAlert aria-hidden className="mx-auto size-7 text-destructive" />
        <p className="mt-3 font-medium">{friendlyErrorMessage(t, error, 'editor.openPageFailed')}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button loading={retrying} onClick={onRetry}>
            {t('common.retry')}
          </Button>
          {/* Pick another page: the list is a drawer on small screens (and may be collapsed). */}
          <Button className={cn(!sidebarCollapsed && 'lg:hidden')} onClick={onShowPages} variant="outline">
            <PanelLeftOpen aria-hidden className="size-4 rtl:-scale-x-100" /> {t('editor.showPages')}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Nothing selected: offer a first page when the site has a language to put it in. */
export function EmptyCanvas({ canCreate, creating, onNewPage }: { canCreate: boolean; creating: boolean; onNewPage: () => void }) {
  const t = useT();
  return (
    <section className="grid flex-1 place-items-center text-center">
      <div>
        <FileText className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-3 font-medium">{t('editor.noPageSelected')}</p>
        <p className="mt-1 text-muted-foreground text-sm">{t('editor.noPageSelectedHint')}</p>
        {canCreate ? (
          <Button className="mt-4 cursor-pointer" disabled={creating} onClick={onNewPage}>
            <Plus className="size-4" /> {t('editor.newPage')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
