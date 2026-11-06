import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { Check, CircleDot, Info, Loader2, TriangleAlert } from 'lucide-react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Autosave feedback for the open page, plus whether readers can see it yet.
 * "Draft saved" (not just "Saved") so nobody mistakes an autosave for a publish.
 * The save state is a polite live region; below `sm` only its icon shows, with
 * the same text kept for screen readers.
 */
export function SaveStatus({
  state,
  publishState,
  unpublishedCount,
}: {
  state: SaveState;
  /** null while unknown (still loading, or no page open). */
  publishState: 'unpublished' | 'published' | null;
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
        <span
          className={cn(
            'hidden items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 md:inline-flex',
            publishState === 'unpublished' ? 'bg-warning/10 text-warning' : 'text-muted-foreground',
          )}
          title={unpublishedCount > 0 ? t('editor.unpublishedCount', { count: unpublishedCount }) : undefined}
        >
          {publishState === 'unpublished' ? <CircleDot aria-hidden className="size-3" /> : <Check aria-hidden className="size-3" />}
          {publishState === 'unpublished' ? t('editor.pageUnpublished') : t('editor.pagePublished')}
        </span>
      ) : null}
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
