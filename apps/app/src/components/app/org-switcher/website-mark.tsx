import { NibleafMark } from '@nibleaf/design-system/brand';
import { cn } from '@nibleaf/design-system/lib/utils';

/** A short emoji icon when the website set one; the Nibleaf mark otherwise. Decorative. */
export function WebsiteMark({ icon, className }: { icon: string | null | undefined; className?: string }) {
  const emoji = icon && Array.from(icon).length <= 2 && !/^[\w-]+$/.test(icon) ? icon : null;
  return (
    <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-md border border-border bg-muted/50 text-sm', className)}>
      {emoji ?? <NibleafMark className="size-4" />}
    </span>
  );
}

/** Live (green) or draft (hollow) dot; the status is also in the row's accessible name. */
export function LiveDot({ live, className }: { live: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full', live ? 'bg-emerald-500' : 'border border-muted-foreground/60 bg-transparent', className)}
      data-live={live}
    />
  );
}
