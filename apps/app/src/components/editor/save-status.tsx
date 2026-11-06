import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { Check, CircleDot, Info, Loader2, TriangleAlert } from 'lucide-react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type PublishState = 'unpublished' | 'published';

/**
 * Autosave feedback for the open page, plus whether readers can see it yet.
 * "Draft saved" (not just "Saved") so nobody mistakes an autosave for a publish.
 * The save state is a polite live region; below `sm` only its icon shows, with
 * the same text kept for screen readers. The header has no room for the publish
 * state below `md`, so phones get it from <PagePublishStateBar> instead (only one
 * of the two is ever rendered, so screen readers never hear it twice).
 */
export function SaveStatus({
  state,
  publishState,
  unpublishedCount,
}: {
  state: SaveState;
  /** null while unknown (still loading, or no page open). */
  publishState: PublishState | null;
  unpublishedCount: number;
}) {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
      <span role="status" aria-live="polite" className="flex items-center gap-1.5">
        {state === 'saving' ? (
          <>
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            <span className="max-sm:sr-only">{t('editor.savingShort')}</span>
          </>
        ) : state === 'saved' ? (
          <>
            <Check aria-hidden className="size-3.5 text-primary" />
            <span className="max-sm:sr-only">{t('editor.savedShort')}</span>
          </>
        ) : state === 'error' ? (
          <>
            <TriangleAlert aria-hidden className="size-3.5 text-destructive" />
            <span className="max-sm:sr-only">{t('editor.saveFailedShort')}</span>
          </>
        ) : null}
      </span>
      {publishState ? (
        <PublishStateChip
          className="hidden md:inline-flex"
          state={publishState}
          title={unpublishedCount > 0 ? t('editor.unpublishedCount', { count: unpublishedCount }) : undefined}
        />
      ) : null}
    </div>
  );
}

/** "Unpublished changes" / "Published" for the open page, in words (never colour alone). */
function PublishStateChip({ state, className, title }: { state: PublishState; className?: string; title?: string }) {
  const t = useT();
  return (
    <span
      className={cn(
        'items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5',
        state === 'unpublished' ? 'bg-warning/10 text-warning' : 'text-muted-foreground',
        className,
      )}
      title={title}
    >
      {state === 'unpublished' ? <CircleDot aria-hidden className="size-3" /> : <Check aria-hidden className="size-3" />}
      {state === 'unpublished' ? t('editor.pageUnpublished') : t('editor.pagePublished')}
    </span>
  );
}

/** Phones (below `md`): the open page's publish state on its own slim row under
 *  the header, so a writer can always read whether this article is live. */
export function PagePublishStateBar({ state }: { state: PublishState }) {
  return (
    <div className="flex items-center border-border border-b bg-background px-3 py-1 text-xs md:hidden">
      <PublishStateChip className="-ms-2 inline-flex" state={state} />
    </div>
  );
}

/** A slim notice under the editor header until the site's first publish. */
export function NeverPublishedBanner() {
  const t = useT();
  return (
    <div className="flex items-center gap-2 border-border border-b bg-muted/50 px-4 py-2 text-muted-foreground text-xs sm:text-sm">
      <Info aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0">{t('editor.neverPublished')}</p>
    </div>
  );
}
