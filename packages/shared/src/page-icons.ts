/**
 * The icon names pages, groups and navigation categories may use: the curated
 * set the reader can draw (`PageIcon` in the app maps each one to an icon).
 * Shared so every write path (dashboard, REST, MCP, import, Git sync) accepts
 * exactly what the reader renders.
 */
export const PAGE_ICON_NAMES = [
  'activity',
  'bar-chart',
  'bar-chart-3',
  'bell',
  'book',
  'book-open',
  'bookmark',
  'box',
  'calendar',
  'check',
  'clock',
  'cloud',
  'code',
  'compass',
  'cpu',
  'credit-card',
  'database',
  'download',
  'file',
  'file-text',
  'flag',
  'folder',
  'git-branch',
  'globe',
  'heart',
  'help',
  'help-circle',
  'home',
  'info',
  'key',
  'layers',
  'lightbulb',
  'life-buoy',
  'lifebuoy',
  'circle-help',
  'house',
  'link-2',
  'link',
  'lock',
  'mail',
  'message-square',
  'package',
  'palette',
  'pen',
  'pen-line',
  'play',
  'plug',
  'puzzle',
  'rocket',
  'search',
  'server',
  'settings',
  'shield',
  'sparkles',
  'star',
  'table',
  'tag',
  'terminal',
  'upload',
  'user',
  'users',
  'wrench',
  'zap',
] as const;
export type PageIconName = (typeof PAGE_ICON_NAMES)[number];

const SUPPORTED = new Set<string>(PAGE_ICON_NAMES);

/** An authored icon name as its lookup key: lower-kebab (`BookOpen`, `book_open` → `book-open`). */
export const normalizePageIconName = (name: string): string =>
  name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

/** Whether an authored icon name resolves to an icon the reader draws. */
export const isSupportedPageIcon = (name?: string | null): boolean => Boolean(name && SUPPORTED.has(normalizePageIconName(name)));

/**
 * For content written by a machine (an import or a Git pull): keep a supported
 * icon, or one the page already had (an older value stays as it was), and drop
 * any other, which the reader would not draw anyway.
 */
export const importedPageIcon = (name: string | null | undefined, existing?: string | null): string | null => {
  if (!name?.trim()) return null;
  return isSupportedPageIcon(name) || name === existing ? name : null;
};
