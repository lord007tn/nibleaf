import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { Eye } from 'lucide-react';

/**
 * A full-width note for a Viewer: what they can do here and who to ask for
 * more. Shown once per screen, above the content, so disabled controls below
 * it never look broken.
 */
export function ViewOnlyBanner({ className }: { className?: string }) {
  const t = useT();
  return (
    <div
      className={cn('flex items-start gap-2.5 border-border border-b bg-muted/50 px-4 py-2.5 text-[13px] leading-snug', className)}
      data-testid="view-only-banner"
      role="status"
    >
      <Eye aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0">
        <span className="font-semibold">{t('access.viewOnly.title')}</span> <span className="text-muted-foreground">{t('access.viewOnly.body')}</span>
      </p>
    </div>
  );
}

/** A compact "View only" chip that explains itself when pressed. For toolbars
 *  where a Viewer's write controls are disabled. */
export function ViewOnlyBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-10',
          className,
        )}
        data-testid="view-only-badge"
      >
        <Eye aria-hidden className="size-3.5" />
        {t('access.viewOnly.badge')}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] gap-1 p-3 text-xs leading-snug">
        <PopoverTitle className="font-medium text-sm">{t('access.viewOnly.title')}</PopoverTitle>
        <PopoverDescription className="text-muted-foreground">{t('access.viewOnly.body')}</PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}
