import { cn } from '@nibleaf/design-system/lib/utils';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { edgeFadeMask, revealOffset, type ScrollEdges, scrollEdges } from './scroll-edges';

/** How wide the fade is, and how far past it the current tab is brought into view. */
const FADE = 40;

/**
 * Sibling views of one page as links, each with its own URL (Analytics'
 * sections, Appearance's sub-pages), styled like the design-system line tabs.
 * A `nav` of links, not an ARIA tablist: each view is a page you can link to,
 * reload and go back to.
 *
 * On narrow screens the row scrolls sideways instead of wrapping. The sides
 * with more tabs past them fade out, so a clipped tab reads as "more this way",
 * and the current tab is scrolled into view whenever it changes.
 */
export function SectionTabs({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const revealed = useRef<string | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });

  // The current tab, scrolled fully into view: when it changes, and again when
  // the row's size changes (the web font arriving, a rotation), since the
  // first measurement can come before the layout settles. Scrolling the row by
  // hand changes no size, so a row the reader scrolled stays put.
  const reveal = useCallback((force: boolean) => {
    const element = row.current;
    const current = element?.querySelector<HTMLElement>('[aria-current="page"]');
    const key = current?.getAttribute('href') ?? null;
    if (!element || !current || (!force && key === revealed.current)) return;
    revealed.current = key;
    const offset = revealOffset(current.getBoundingClientRect(), element.getBoundingClientRect(), FADE);
    if (offset !== 0) element.scrollBy({ left: offset });
  }, []);

  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const update = () => {
      const next = scrollEdges({
        scrollLeft: element.scrollLeft,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        rtl: getComputedStyle(element).direction === 'rtl',
      });
      setEdges((previous) => (previous.left === next.left && previous.right === next.right ? previous : next));
    };
    const resized = () => {
      reveal(true);
      update();
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resized);
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [reveal]);

  useLayoutEffect(() => reveal(false));

  const mask = edgeFadeMask(edges, FADE);
  return (
    <nav aria-label={label} className={cn('-mx-1 border-border border-b', className)} data-slot="section-tabs">
      <div
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-overflow-left={edges.left || undefined}
        data-overflow-right={edges.right || undefined}
        ref={row}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        <ul className="flex min-w-max items-center gap-1 px-1">{children}</ul>
      </div>
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
