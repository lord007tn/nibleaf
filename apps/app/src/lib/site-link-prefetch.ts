import { readSiteStorage, writeSiteStorage } from '@/lib/site-storage';

/*
 * Prefetching for the reader's plain `<a href>` page links (READER-05b). The
 * router's own `defaultPreload: 'intent'` only covers its `<Link>` component,
 * and reader links stay plain anchors so they work without JavaScript, so
 * intent is detected here and handed to `router.preloadRoute`: the page's real
 * loaders run (its data and its article renderer), and the click finds them
 * warm. A preload only loads; nothing renders, so it never counts as a view.
 */

export type PreloadIntent = 'hover' | 'focus' | 'touch' | 'idle';

/** A link preloaded this recently isn't preloaded again: inside the page
 *  query's 30 s stale time, the cached copy still serves the click. */
export const PRELOAD_FRESH_MS = 25_000;
const MAX_PRELOADS_IN_FLIGHT = 2;
/** A pointer that merely crosses a link on its way somewhere else is not intent. */
export const HOVER_DWELL_MS = 60;

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

/** Data saver or a 2g-class connection: speculative loads (hover, idle) are skipped. */
export const constrainedNetwork = (
  connection: NetworkInformationLike | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { connection?: NetworkInformationLike }).connection,
): boolean => Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType ?? '');

/**
 * A preload function that dedupes recent links, keeps at most two loads in
 * flight, and skips speculative intents on a constrained network. Focus and
 * touch are strong intent (the reader is about to open the link), so they
 * prefetch even there. Returns whether a preload started.
 */
export function createLinkPreloader({
  preload,
  now = Date.now,
  constrained = constrainedNetwork,
}: {
  preload: (href: string) => Promise<unknown>;
  now?: () => number;
  constrained?: () => boolean;
}) {
  const recent = new Map<string, number>();
  let inFlight = 0;
  return (href: string, intent: PreloadIntent): boolean => {
    if ((intent === 'hover' || intent === 'idle') && constrained()) return false;
    const at = recent.get(href);
    const time = now();
    if (at !== undefined && time - at < PRELOAD_FRESH_MS) return false;
    if (inFlight >= MAX_PRELOADS_IN_FLIGHT) return false;
    recent.set(href, time);
    inFlight += 1;
    void Promise.resolve()
      .then(() => preload(href))
      .catch(() => {
        // A failed preload is simply not cached: the click loads the page itself.
        recent.delete(href);
      })
      .finally(() => {
        inFlight -= 1;
      });
    return true;
  };
}

const FALLBACK_KEY = 'nibleaf.reader.navigation-fallback';
/** How long one full-page fallback for a URL counts against reloading again. */
export const FALLBACK_TTL_MS = 60_000;

/**
 * Whether a failed client navigation to `href` may fall back to a full page
 * load now, recording that it did. A second failure for the same URL within
 * the TTL (say the server-rendered page fails as well) shows the error page
 * instead of reloading again, and so does a browser without session storage:
 * never a reload loop.
 */
export function claimNavigationFallback(href: string, now = Date.now()): boolean {
  let claims: Record<string, number> = {};
  try {
    claims = JSON.parse(readSiteStorage('sessionStorage', FALLBACK_KEY) ?? '{}') as Record<string, number>;
  } catch {
    claims = {};
  }
  const live = Object.fromEntries(Object.entries(claims).filter(([, at]) => typeof at === 'number' && now - at < FALLBACK_TTL_MS));
  if (live[href] !== undefined) return false;
  live[href] = now;
  return writeSiteStorage('sessionStorage', FALLBACK_KEY, JSON.stringify(live));
}
