import { useEffect, useState } from 'react';

/** The visible part of the layout viewport, in CSS pixels. */
export type VisualViewportBox = { height: number; top: number };

/**
 * The visual viewport's height and offset while `active`: the part of the page a
 * phone's software keyboard leaves visible. Under the default viewport behaviour
 * `dvh` doesn't shrink for the keyboard, so a full-height sheet sized with it
 * runs under the keyboard; sized and placed with this box, its bottom stays in view.
 *
 * Null until the first reading, and always where there is no `visualViewport`
 * (SSR, older browsers): callers keep their `dvh` sizing then. Listening stops when
 * `active` turns false or the caller unmounts. The last reading stays while
 * `retain` is true, so a sheet still animating out doesn't change size mid-exit;
 * once `retain` turns false it is dropped, and the next opening starts fresh.
 */
export function useVisualViewport(active: boolean, retain = true): VisualViewportBox | null {
  const [box, setBox] = useState<VisualViewportBox | null>(null);
  useEffect(() => {
    if (!retain) setBox(null);
  }, [retain]);
  useEffect(() => {
    const visual = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!active || !visual) return;
    const update = () =>
      setBox((last) => (last?.height === visual.height && last.top === visual.offsetTop ? last : { height: visual.height, top: visual.offsetTop }));
    update();
    visual.addEventListener('resize', update);
    visual.addEventListener('scroll', update);
    return () => {
      visual.removeEventListener('resize', update);
      visual.removeEventListener('scroll', update);
    };
  }, [active]);
  return box;
}
