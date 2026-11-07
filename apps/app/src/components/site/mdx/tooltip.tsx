import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { linkKey } from './utils';

// ─── Tooltip ────────────────────────────────────────────────────────────────

export function Tooltip({ tip, children }: { tip?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pointerOpen = useRef(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const links = linkKey(children);
  const linked = links !== '';
  // A tooltip around links has no button of its own, so every link carries the
  // description, added to any it already has. It re-runs when the links change
  // (so a link added later is described too), and cleanup removes only the
  // tooltip's own id, so descriptions changed meanwhile by anything else stay.
  useEffect(() => {
    if (!tip || links === '') return;
    const tokens = (link: HTMLElement) => (link.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const described = [...(wrapper.current?.querySelectorAll<HTMLElement>('a[href], [href]') ?? [])];
    for (const link of described) link.setAttribute('aria-describedby', [...new Set([...tokens(link), id])].join(' '));
    return () => {
      for (const link of described) {
        const remaining = tokens(link).filter((token) => token !== id);
        if (remaining.length > 0) link.setAttribute('aria-describedby', remaining.join(' '));
        else link.removeAttribute('aria-describedby');
      }
    };
  }, [tip, links, id]);
  if (!tip) return <>{children}</>;
  return (
    // Hover, focus and Escape are handled on the wrapper so the pointer can move
    // onto the tip without closing it (WCAG 1.4.13) and focus inside a link works.
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the focusable trigger is a child; the wrapper only keeps the tip open.
    <span
      ref={wrapper}
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      {linked ? (
        children
      ) : (
        <button
          type="button"
          aria-describedby={id}
          className="cursor-help underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
          onPointerDown={() => {
            pointerOpen.current = open;
          }}
          onClick={(event) => setOpen(event.detail ? !pointerOpen.current : !open)}
        >
          {children}
        </button>
      )}
      {/* Bottom padding, not a margin, keeps the gap above the trigger hoverable. */}
      <span id={id} role="tooltip" hidden={!open} className="absolute start-0 bottom-full z-20 w-max max-w-[min(20rem,80vw)] pb-2">
        <span className="block rounded-md border border-border bg-popover p-2 text-popover-foreground text-sm shadow-md">{tip}</span>
      </span>
    </span>
  );
}
