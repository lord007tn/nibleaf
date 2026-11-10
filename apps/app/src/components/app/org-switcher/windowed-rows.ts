import { type RefObject, useEffect, useState } from 'react';

/** Lists longer than this render only the rows in view (design §5.4.1). */
export const WINDOW_THRESHOLD = 50;
const OVERSCAN = 6;

/**
 * Fixed-height windowing for the switcher's listboxes. Below the threshold
 * every row renders. Above it only the visible slice plus overscan does, with
 * spacers keeping the scroll height; `activeIndex` is scrolled into view so
 * the option `aria-activedescendant` points at always exists in the DOM.
 */
export function useWindowedRows(container: RefObject<HTMLElement | null>, count: number, rowHeight: number, activeIndex: number) {
  const windowed = count > WINDOW_THRESHOLD;
  const [view, setView] = useState({ top: 0, height: rowHeight * 12 });

  useEffect(() => {
    const element = container.current;
    if (!windowed || !element) return;
    const update = () => setView({ top: element.scrollTop, height: element.clientHeight || rowHeight * 12 });
    update();
    element.addEventListener('scroll', update, { passive: true });
    return () => element.removeEventListener('scroll', update);
  }, [container, windowed, rowHeight]);

  useEffect(() => {
    const element = container.current;
    if (!element || activeIndex < 0) return;
    const rowTop = activeIndex * rowHeight;
    const height = element.clientHeight || rowHeight * 12;
    if (windowed) {
      if (rowTop < element.scrollTop) element.scrollTop = rowTop;
      else if (rowTop + rowHeight > element.scrollTop + height) element.scrollTop = rowTop + rowHeight - height;
      setView({ top: element.scrollTop, height });
    } else {
      element.querySelector(`[data-row-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [container, activeIndex, rowHeight, windowed]);

  if (!windowed) return { start: 0, end: count, padStart: 0, padEnd: 0, windowed };
  const start = Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN);
  const end = Math.min(count, Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN);
  return { start, end, padStart: start * rowHeight, padEnd: (count - end) * rowHeight, windowed };
}
