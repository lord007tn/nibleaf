import { parseMdxList } from '@nibleaf/shared/mdx-attributes';
import { Children, isValidElement, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef } from 'react';

/** An authored boolean prop: present (`defaultOpen`), empty, or the string "true". */
export const truthyAttr = (value: unknown): boolean => value === true || value === '' || value === 'true';

/** Arrow/Home/End navigation between tabs, mirrored on right-to-left pages. */
export function handleTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  current: number,
  count: number,
  language: string | undefined,
  setActive: (index: number) => void,
  tabRefs: Array<HTMLButtonElement | null>,
) {
  const explicitDirection = event.currentTarget.closest('[dir]')?.getAttribute('dir');
  const rtl = explicitDirection ? explicitDirection === 'rtl' : /^(ar|fa|he|ur)(-|$)/i.test(language ?? '');
  let next: number | undefined;
  if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = count - 1;
  } else if (event.key === 'ArrowRight') {
    next = (current + (rtl ? -1 : 1) + count) % count;
  } else if (event.key === 'ArrowLeft') {
    next = (current + (rtl ? 1 : -1) + count) % count;
  }
  if (next === undefined) {
    return;
  }
  event.preventDefault();
  setActive(next);
  tabRefs[next]?.focus();
}

/** True when the content holds a link, which must not be nested in a button. */
export const containsLink = (node: ReactNode): boolean =>
  Children.toArray(node).some(
    (child) =>
      isValidElement<{ href?: unknown; children?: ReactNode }>(child) &&
      (child.type === 'a' || child.props.href !== undefined || containsLink(child.props.children)),
  );

/** An authored number prop (`3`, `"3"`), or undefined when it is not a finite number. */
export const optionalNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** An authored list prop: `["A", "B"]` as JSON (literal JSX arrays arrive this way) or one plain value. */
export const authoredList = (value: unknown): string[] => parseMdxList(value);

/** A heading-style anchor slug: lowercase letters and numbers in any script, joined by hyphens. */
const anchorSlug = (value: string | undefined): string | undefined => {
  const slug = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}\s_-]+/gu, '')
    .replace(/\s+/g, '-');
  return slug || undefined;
};

/** An authored `id` prop. The sanitizer prefixes ids (`user-content-…`) against DOM
 *  clobbering; the prefix is removed here and the value reduced to a safe slug. */
export const authoredAnchor = (value: unknown): string | undefined =>
  typeof value === 'string' ? anchorSlug(value.replace(/^user-content-/, '')) : undefined;

/** True when the page's location hash names this anchor (or the slug of a fallback title). */
export const hashMatches = (hash: string, id: string | undefined, title: string | undefined): boolean => {
  if (!hash) return false;
  let decoded = hash.replace(/^#/, '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the raw hash.
  }
  const wanted = decoded.toLowerCase();
  return Boolean(wanted && (wanted === id || wanted === anchorSlug(title)));
};

/** Follow the location hash (on load and on change) so deep links can open a tab or an accordion. */
export function useLocationHash(onHash: (hash: string) => void) {
  const latest = useRef(onHash);
  latest.current = onHash;
  useEffect(() => {
    const apply = () => latest.current(window.location.hash);
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);
}

const CSS_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch)\([\d\s.,%/+-]+\)|[a-z]{3,24})$/i;

/** An authored color that is safe to put in a style value: a hex code, a color function of numbers, or a color keyword. */
export const authoredColor = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : '';
  return CSS_COLOR.test(text) ? text : undefined;
};
