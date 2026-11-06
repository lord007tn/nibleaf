import { skeletonClassName } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';

/**
 * The design-system `Skeleton` block rendered as a `<span>`, for placeholders
 * inside phrasing content (a heading, a button label) where a `<div>` is invalid.
 * Same look, from the design system's `skeletonClassName`: pulses gently and
 * stays still for reduced-motion users. Hidden from screen readers; announce
 * loading on the surrounding region instead.
 */
export function InlineSkeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block', skeletonClassName, className)} data-slot="skeleton" />;
}
