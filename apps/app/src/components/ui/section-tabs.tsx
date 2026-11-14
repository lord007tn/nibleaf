import { cn } from '@nibleaf/design-system/lib/utils';
import type { ReactNode } from 'react';

/**
 * Sibling views of one page as links, each with its own URL (Analytics'
 * sections, Appearance's sub-pages), styled like the design-system line tabs.
 * A `nav` of links, not an ARIA tablist: each view is a page you can link to,
 * reload and go back to. Scrolls sideways on narrow screens instead of wrapping.
 */
export function SectionTabs({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className={cn('-mx-1 overflow-x-auto border-border border-b', className)} data-slot="section-tabs">
      <ul className="flex min-w-max items-center gap-1 px-1">{children}</ul>
    </nav>
  );
}

/** One tab's link classes. The active link also gets `aria-current="page"`. */
export const sectionTabClassName = cn(
  'relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground pointer-coarse:min-h-11',
  'after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0 after:transition-opacity',
  'rounded-t-md focus-visible:outline-2 focus-visible:outline-ring',
  'aria-[current=page]:text-foreground aria-[current=page]:after:opacity-100',
);
