import { Children, isValidElement, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

/** An authored boolean prop: present (`defaultOpen`), empty, the string "true",
 *  or the JSX expression `{true}` that Mintlify pages often use. */
export const truthyAttr = (value: unknown): boolean => {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text === '' || text === 'true' || text === '{true}';
};

/** Only a plain color value reaches an inline style: a hex code, a color name,
 *  or a color function with plain arguments. Anything else is dropped. */
export const plainCssColor = (value: unknown): string | undefined => {
  const color = typeof value === 'string' ? value.trim() : '';
  return /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([\w\s.,%/+-]*\))$/i.test(color)
    ? color
    : undefined;
};

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

/** A key naming every link in the content (one `<href>` token per link), or
 *  `''` when there is none. Links must not be nested in a button, and the key
 *  changes whenever links are added, removed or retargeted. */
export const linkKey = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => {
      if (!isValidElement<{ href?: unknown; children?: ReactNode }>(child)) return '';
      const own = child.type === 'a' || child.props.href !== undefined ? `<${String(child.props.href ?? '')}>` : '';
      return own + linkKey(child.props.children);
    })
    .join('');
