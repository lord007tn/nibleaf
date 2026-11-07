import { Children, isValidElement, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

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
