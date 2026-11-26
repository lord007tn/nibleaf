import { useEffect, useState } from 'react';

export interface ScrollEdges {
  /** More content before the visible part (above, or before in reading order). */
  start: boolean;
  /** More content after the visible part. */
  end: boolean;
}

const NONE: ScrollEdges = { start: false, end: false };

/** Which edges of a scrolling box hide content, along one axis. Half a pixel is ignored (zoom rounding). */
export function scrollEdges(element: HTMLElement, axis: 'x' | 'y'): ScrollEdges {
  if (axis === 'y') {
    const hidden = element.scrollHeight - element.clientHeight;
    return { start: element.scrollTop > 0.5, end: element.scrollTop < hidden - 0.5 };
  }
  const hidden = element.scrollWidth - element.clientWidth;
  // Right to left, scrollLeft runs from 0 down to -hidden.
  const along = Math.abs(element.scrollLeft);
  return { start: along > 0.5, end: along < hidden - 0.5 };
}

/**
 * Keeps `scrollEdges` for an element as it scrolls or resizes, so a list that
 * scrolls can say so with a fade at the edge where more content is hidden.
 */
export function useScrollEdges(element: HTMLElement | null, axis: 'x' | 'y'): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>(NONE);
  useEffect(() => {
    if (!element) return;
    const update = () =>
      setEdges((current) => {
        const next = scrollEdges(element, axis);
        return next.start === current.start && next.end === current.end ? current : next;
      });
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [element, axis]);
  return edges;
}

/**
 * A mask that fades the hidden edges of a scrolling box (`--scroll-fade` long),
 * as a style: vertical boxes fade top and bottom, horizontal ones their start and
 * end in reading order.
 */
export function scrollFadeStyle(edges: ScrollEdges, axis: 'x' | 'y', rtl = false): { maskImage?: string; WebkitMaskImage?: string } {
  if (!edges.start && !edges.end) return {};
  const towards = axis === 'y' ? 'to bottom' : rtl ? 'to left' : 'to right';
  const fade = 'var(--scroll-fade, 1.5rem)';
  const from = edges.start ? `transparent, black ${fade}` : 'black';
  const to = edges.end ? `black calc(100% - ${fade}), transparent` : 'black';
  const image = `linear-gradient(${towards}, ${from}, ${to})`;
  return { maskImage: image, WebkitMaskImage: image };
}
