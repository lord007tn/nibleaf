import { useSyncExternalStore } from 'react';

/**
 * Hydration-safe keyboard-shortcut labels. Apple keyboards show ⌘, everything
 * else shows Ctrl. The server can't know the visitor's platform, so it always
 * renders the `other` label and the client corrects it after hydration via
 * useSyncExternalStore (no mismatch warning, no flash of wrong markup on the
 * server-rendered HTML beyond the first paint).
 */
export type ShortcutPlatform = 'apple' | 'other';

type NavigatorLike = { platform?: string; userAgent?: string; userAgentData?: { platform?: string } };

// Matches macOS ("MacIntel", "Macintosh", "macOS"), iOS/iPadOS ("iPhone",
// "iPad", "iPod", "iOS") in navigator.platform, userAgentData.platform, or the
// user-agent string. Word-bounded so unrelated tokens never match.
const APPLE_PLATFORM = /\b(?:mac(?:intosh|intel|os)?|iphone|ipad|ipod|ios)\b/i;

export const detectShortcutPlatform = (nav?: NavigatorLike | null): ShortcutPlatform => {
  if (!nav) return 'other';
  const haystack = [nav.userAgentData?.platform, nav.platform, nav.userAgent].filter(Boolean).join(' ');
  return APPLE_PLATFORM.test(haystack) ? 'apple' : 'other';
};

export const searchShortcutLabel = (platform: ShortcutPlatform): string => (platform === 'apple' ? '⌘K' : 'Ctrl K');

const subscribe = () => () => undefined;
const getServerPlatform = (): ShortcutPlatform => 'other';

let clientPlatform: ShortcutPlatform | undefined;
const getClientPlatform = (): ShortcutPlatform => {
  clientPlatform ??= detectShortcutPlatform(globalThis.navigator);
  return clientPlatform;
};

/** The search hotkey label ("⌘K" / "Ctrl K") for the visitor's platform. */
export function useSearchShortcutLabel(): string {
  return searchShortcutLabel(useSyncExternalStore(subscribe, getClientPlatform, getServerPlatform));
}
