import { useSyncExternalStore } from 'react';
import { readSiteStorage, writeSiteStorage } from '@/lib/site-storage';

/*
 * The bare '/' search shortcut, which readers can turn off (WCAG 2.1.4
 * Character Key Shortcuts): a single printable key can fire by accident, or
 * from speech input, and move focus into search. It is on by default, so
 * readers can discover it, and the switch sits next to the other key hints in
 * the search dialog's footer. The choice is kept per site. ⌘K / Ctrl+K has a
 * modifier, so it is always on.
 */

const SLASH_SHORTCUT_DEFAULT = true;

const PREFIX = 'nibleaf:site-search:slash-shortcut:';
// What the reader chose during this page view when it couldn't be saved (storage
// blocked, or full). It wins over whatever storage still holds until they leave.
const chosen = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** Whether '/' opens search on this site, for this reader. */
export const readSlashShortcut = (projectId: string): boolean => {
  const unsaved = chosen.get(projectId);
  if (unsaved !== undefined) return unsaved;
  const stored = readSiteStorage('localStorage', PREFIX + projectId);
  return stored === 'on' || stored === 'off' ? stored === 'on' : SLASH_SHORTCUT_DEFAULT;
};

export const writeSlashShortcut = (projectId: string, on: boolean): void => {
  if (writeSiteStorage('localStorage', PREFIX + projectId, on ? 'on' : 'off')) chosen.delete(projectId);
  else chosen.set(projectId, on);
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  // Another tab of the same site changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

export const useSlashShortcut = (projectId: string): boolean =>
  useSyncExternalStore(
    subscribe,
    () => readSlashShortcut(projectId),
    () => SLASH_SHORTCUT_DEFAULT,
  );

/** The search trigger's `aria-keyshortcuts`: the shortcut it shows first, and '/' only while it is on. */
export const searchKeyShortcuts = (hotkey: 'cmdk' | 'slash' | undefined, slashOn: boolean): string => {
  if (!slashOn) return 'Control+K Meta+K';
  return hotkey === 'slash' ? '/ Control+K Meta+K' : 'Control+K Meta+K /';
};
