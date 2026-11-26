import { detectShortcutPlatform } from '@/lib/shortcut';

/** True on macOS and iOS, where the shortcut modifier is ⌘ rather than Ctrl. */
export const isApplePlatform = () => detectShortcutPlatform(globalThis.navigator) === 'apple';

/**
 * A Ctrl/⌘ shortcut as the platform writes it: `Ctrl+Shift+8` on Windows and
 * Linux, `⌘⇧8` on a Mac. `keys` is what follows the modifier, `+`-separated
 * (`B`, `Shift+8`, `Alt+1`).
 */
export function modShortcut(keys: string, apple = isApplePlatform()): string {
  if (!apple) return `Ctrl+${keys}`;
  return `⌘${keys.replaceAll('Shift+', '⇧').replaceAll('Alt+', '⌥')}`;
}

/** A control's label with its shortcut: "Bold (Ctrl+B)". */
export const withShortcut = (label: string, keys?: string, apple = isApplePlatform()): string =>
  keys ? `${label} (${modShortcut(keys, apple)})` : label;
