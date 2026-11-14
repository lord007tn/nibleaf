/** Which physical sides of a sideways-scrolling row have more content past them. */
export type ScrollEdges = { left: boolean; right: boolean };

/**
 * The sides with hidden content, from the row's scroll metrics. In RTL,
 * browsers report `scrollLeft` from 0 at the start (the right edge) down to
 * `-(scrollWidth - clientWidth)` at the end, so it is turned into a distance
 * from the left first. A pixel of slack absorbs sub-pixel rounding.
 */
export function scrollEdges({
  scrollLeft,
  scrollWidth,
  clientWidth,
  rtl,
}: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  rtl: boolean;
}): ScrollEdges {
  const max = scrollWidth - clientWidth;
  if (max <= 1) return { left: false, right: false };
  const fromLeft = rtl ? max + scrollLeft : scrollLeft;
  return { left: fromLeft > 1, right: fromLeft < max - 1 };
}

/**
 * A mask that fades the sides with hidden content, so a clipped tab reads as
 * "there's more this way" instead of a cut-off word. Undefined when nothing is
 * hidden.
 */
export function edgeFadeMask(edges: ScrollEdges, fade = 24): string | undefined {
  if (!edges.left && !edges.right) return undefined;
  const start = edges.left ? `transparent 0, #000 ${fade}px` : '#000 0';
  const end = edges.right ? `#000 calc(100% - ${fade}px), transparent 100%` : '#000 100%';
  return `linear-gradient(to right, ${start}, ${end})`;
}

/**
 * How far to scroll the row (physical pixels, as `scrollBy` takes them) so the
 * item is fully visible with up to `inset` to spare, or 0 when it already is, or
 * when the row isn't laid out yet (no width).
 */
export function revealOffset(item: { left: number; right: number }, row: { left: number; right: number }, inset = 24): number {
  const width = row.right - row.left;
  if (width <= 0) return 0;
  const availableInset = Math.min(inset, Math.max(0, (width - (item.right - item.left)) / 2));
  if (item.left < row.left + availableInset) return item.left - row.left - availableInset;
  if (item.right > row.right - availableInset) return item.right - row.right + availableInset;
  return 0;
}
