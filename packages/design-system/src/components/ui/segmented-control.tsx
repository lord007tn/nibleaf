import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** The shell owns the outer size; items use only its remaining inner height. */
function SegmentedControl({ className, density = 'default', ...props }: ComponentProps<'div'> & { density?: 'default' | 'compact' }) {
  return (
    <div
      data-slot="segmented-control"
      data-density={density}
      className={cn(
        'inline-flex min-w-0 flex-wrap items-stretch gap-0.5 rounded-lg bg-muted p-(--control-group-inset) [--segmented-height:var(--control-size-default)] data-[density=compact]:[--segmented-height:var(--control-size-compact)] min-h-(--segmented-height)',
        className,
      )}
      {...props}
    />
  );
}

function SegmentedControlItem({ className, active, ...props }: ComponentProps<'button'> & { active: boolean }) {
  return (
    <button
      type="button"
      data-slot="segmented-control-item"
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-[calc(var(--segmented-height)-2*var(--control-group-inset))] min-w-[calc(var(--segmented-height)-2*var(--control-group-inset))] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1 text-center font-medium text-[13px] whitespace-normal transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:shrink-0',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { SegmentedControl, SegmentedControlItem };
