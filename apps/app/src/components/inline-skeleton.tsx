import { cn } from '@nibleaf/design-system/lib/utils';

/**
 * The design-system `Skeleton` block rendered as a `<span>`, for placeholders
 * inside phrasing content (a heading, a button label) where a `<div>` is invalid.
 * Same look: pulses gently and stays still for reduced-motion users. Hidden from
 * screen readers; announce loading on the surrounding region instead.
 */
export function InlineSkeleton({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('block animate-pulse rounded-md bg-foreground/8 motion-reduce:animate-none', className)} data-slot="skeleton" />
  );
}
