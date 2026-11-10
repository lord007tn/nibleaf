import { useSyncExternalStore } from 'react';

/** Design §5.4.1: at 640 px and below the switcher is a full-height sheet with drill-down. */
export const COMPACT_SWITCHER_QUERY = '(max-width: 640px)';

const subscribe = (onChange: () => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(COMPACT_SWITCHER_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_SWITCHER_QUERY).matches;

export const useCompactSwitcher = () => useSyncExternalStore(subscribe, read, () => false);
