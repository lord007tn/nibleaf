import { siteContentT } from '@nibleaf/i18n/site-content';
import type { ElementContent, Element as HastElement } from 'hast';
import { type ComponentProps, type RefObject, useEffect, useRef, useState } from 'react';

/** Where a horizontal scroller stands: whether it overflows at all, and whether
 *  content waits past its inline start or inline end edge. */
export interface ScrollOverflow {
  overflow: boolean;
  start: boolean;
  end: boolean;
}

const FITS: ScrollOverflow = { overflow: false, start: false, end: false };

/** Measure a horizontal scroller (and keep measuring as it or its content
 *  resizes, or as the reader scrolls it). Nothing runs on the server: a block
 *  renders as a plain block until the browser says it overflows. */
export function useScrollOverflow(ref: RefObject<HTMLElement | null>): ScrollOverflow {
  const [state, setState] = useState(FITS);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = element.scrollWidth - element.clientWidth;
      const overflow = max > 1;
      // scrollLeft runs negative in a right-to-left scroller, so its distance
      // from the start edge is the magnitude in either direction.
      const position = Math.abs(element.scrollLeft);
      const next = { overflow, start: overflow && position > 1, end: overflow && position < max - 1 };
      setState((previous) => (previous.overflow === next.overflow && previous.start === next.start && previous.end === next.end ? previous : next));
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(measure);
      }
    };
    measure();
    // The scroller keeps its width when its content widens (fonts load,
    // highlighting lands), so watch the content too.
    // Without ResizeObserver (old engines, test DOMs) the window's size stands in.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    if (observer) {
      observer.observe(element);
      for (const child of Array.from(element.children)) {
        observer.observe(child);
      }
    } else {
      window.addEventListener('resize', schedule);
    }
    element.addEventListener('scroll', schedule, { passive: true });
    // A web font (Geist Mono) can widen the text after the first measure
    // without resizing any observed box: a <pre>'s <code> is inline, and
    // ResizeObserver never reports inline boxes. Measure again once the fonts
    // in use have loaded, and whenever a later one finishes.
    const fonts = 'fonts' in document ? document.fonts : undefined;
    let mounted = true;
    fonts?.ready.then(() => {
      if (mounted) {
        schedule();
      }
    });
    fonts?.addEventListener('loadingdone', schedule);
    return () => {
      mounted = false;
      fonts?.removeEventListener('loadingdone', schedule);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      element.removeEventListener('scroll', schedule);
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, [ref]);
  return state;
}

/** The attributes that make an overflowing block a keyboard-reachable, named
 *  region with a fade on each edge where content waits (typeset.css,
 *  `[data-scroll-region]`). A block that fits gets none of them, so it stays
 *  out of the tab order and the landmark list (WCAG 2.1.1, axe
 *  scrollable-region-focusable). */
export function scrollRegionProps(state: ScrollOverflow, label: string) {
  if (!state.overflow) {
    return {};
  }
  return {
    tabIndex: 0,
    role: 'region',
    'aria-label': label,
    'data-scroll-region': '',
    'data-fade-start': state.start ? '' : undefined,
    'data-fade-end': state.end ? '' : undefined,
  } as const;
}

/** Text of the last heading before `element` in its article, to name the region. */
export function precedingHeadingText(element: Element): string | undefined {
  const root = element.closest('.typeset') ?? element.ownerDocument.body;
  let found: Element | undefined;
  for (const heading of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    // Headings come back in document order: stop at the first one after the element.
    if (!(heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      break;
    }
    found = heading;
  }
  const text = found?.textContent?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

type RegionKind = 'table' | 'code';
const REGION_SELECTOR: Record<RegionKind, string> = { table: '.typeset-scroll', code: '[data-theme-component="code"] > pre' };

/** Joins a name and its section. Not Intl.ListFormat: its Arabic "unit" list
 *  joins with و ("and"), which reads as two things rather than one in a section. */
const listSeparator = (locale?: string) => {
  const language = (locale ?? 'en').toLowerCase().split('-')[0];
  if (language === 'ar' || language === 'ur') return '، ';
  if (language === 'zh') return '，';
  return ', ';
};

/** What tells a block apart before its section: a code block's title or language. */
const regionPrimary = (element: Element) => element.getAttribute('data-region-name') ?? '';

/**
 * A region's name: its kind, what it is (a code block's title or language),
 * and the section it sits in ("Code: bash, Register an endpoint"), so a
 * screen reader's landmark list tells regions apart (WAI-ARIA APG, region).
 * Blocks that would still share a name are numbered in reading order.
 */
function regionName(element: Element, kind: RegionKind, locale?: string): string {
  const t = siteContentT(locale);
  const section = precedingHeadingText(element);
  const primary = regionPrimary(element);
  const parts = [primary, section].filter((part): part is string => Boolean(part));
  const named = parts.join(listSeparator(locale));
  const base = kind === 'table' ? (named ? t('tableOf', { name: named }) : t('table')) : named ? t('codeOf', { name: named }) : t('code');
  const root = element.closest('.typeset') ?? element.ownerDocument.body;
  const twins = Array.from(root.querySelectorAll(REGION_SELECTOR[kind])).filter(
    (other) => regionPrimary(other) === primary && precedingHeadingText(other) === section,
  );
  return twins.length > 1 ? `${base} (${(twins.indexOf(element) + 1).toLocaleString(locale)})` : base;
}

/** The name an overflowing block takes as a region, worked out once it overflows. */
export function useRegionName(ref: RefObject<HTMLElement | null>, overflow: boolean, kind: RegionKind, locale?: string): string {
  const [name, setName] = useState('');
  useEffect(() => {
    if (overflow && ref.current) setName(regionName(ref.current, kind, locale));
  }, [overflow, ref, kind, locale]);
  return name;
}

/** A Markdown table in its scroll wrapper. The table fits the column first and
 *  scrolls only when its cells cannot shrink any further; then the wrapper
 *  becomes a named region ("Table: <section heading>") a keyboard can reach,
 *  with an edge fade where columns are hidden. */
// `node` is react-markdown's hast node; it must not reach the DOM.
export function ScrollTable({ locale, node: _node, ...props }: ComponentProps<'table'> & { locale?: string; node?: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useScrollOverflow(ref);
  const name = useRegionName(ref, state.overflow, 'table', locale);
  return (
    <div ref={ref} className="typeset-scroll" {...scrollRegionProps(state, name)}>
      <table {...props} />
    </div>
  );
}

/** A cell this long, with spaces in it, is prose: give its column a readable
 *  measure (typeset.css, `[data-cell-prose]`) rather than one word per line. */
const PROSE_CELL_CHARACTERS = 32;

function hastTextLength(nodes: readonly ElementContent[]): { length: number; spaced: boolean } {
  let length = 0;
  let spaced = false;
  for (const node of nodes) {
    if (node.type === 'text') {
      length += node.value.length;
      spaced ||= /\s/.test(node.value.trim());
    } else if (node.type === 'element') {
      const inner = hastTextLength(node.children);
      length += inner.length;
      spaced ||= inner.spaced;
    }
  }
  return { length, spaced };
}

/** Whether a table cell holds running prose (decided from the Markdown, so the
 *  server and the browser agree and nothing shifts after hydration). */
export function isProseCell(node: HastElement | undefined): boolean {
  if (!node) {
    return false;
  }
  const { length, spaced } = hastTextLength(node.children);
  return spaced && length >= PROSE_CELL_CHARACTERS;
}

// `node` is react-markdown's hast node; it must not reach the DOM.
type CellProps<Tag extends 'td' | 'th'> = ComponentProps<Tag> & { node?: HastElement };

export function TableCell({ node, ...props }: CellProps<'td'>) {
  return <td {...props} data-cell-prose={isProseCell(node) ? '' : undefined} />;
}

export function TableHeaderCell({ node, ...props }: CellProps<'th'>) {
  return <th {...props} data-cell-prose={isProseCell(node) ? '' : undefined} />;
}
