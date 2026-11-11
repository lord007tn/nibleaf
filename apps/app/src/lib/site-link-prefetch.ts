import { runSpeculative } from '@/lib/document-recovery';

/*
 * Prefetching for the reader's plain `<a href>` page links (READER-05b). The
 * router's own `defaultPreload: 'intent'` only covers its `<Link>` component,
 * and reader links stay plain anchors so they work without JavaScript, so
 * intent is detected here and handed to `router.preloadRoute`: the page's real
 * loaders run (its data and its article renderer), and the click finds them
 * warm. A preload only loads; nothing renders, so it never counts as a view.
 *
 * Only public sites are prefetched (lib/reader-site-access.ts): a restricted
 * page is never loaded before the reader asks for it.
 */

export type PreloadIntent = 'hover' | 'focus' | 'touch' | 'idle';

/** A link preloaded this recently isn't preloaded again: inside the page
 *  query's 30 s stale time, the cached copy still serves the click. */
export const PRELOAD_FRESH_MS = 25_000;
/** Remembered links, oldest dropped first. */
export const PRELOAD_MEMORY = 200;
const MAX_PRELOADS_IN_FLIGHT = 2;
/** A pointer that merely crosses a link on its way somewhere else is not intent. */
export const HOVER_DWELL_MS = 60;
/** A touch that moves further than this is a scroll, not a tap. */
export const TAP_SLOP_PX = 10;

/** Query parameters that select a different page; anything else (tracking, a
 *  search highlight) is the same page and the same prefetch. */
const PAGE_QUERY = ['lang'];

/** One key per page: path plus page-selecting query, never the fragment. */
export function preloadKey(href: string, base = 'http://reader.invalid'): string {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return href;
  }
  const query = PAGE_QUERY.filter((name) => url.searchParams.has(name)).map((name) => `${name}=${url.searchParams.get(name)}`);
  return query.length > 0 ? `${url.pathname}?${query.join('&')}` : url.pathname;
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

/** Data saver or a 2g-class connection: speculative loads are skipped. */
export const constrainedNetwork = (
  connection: NetworkInformationLike | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { connection?: NetworkInformationLike }).connection,
): boolean => Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType ?? '');

/**
 * A preload function that remembers recent links in a bounded TTL cache keyed
 * by page (preloadKey), tracks loads in flight separately, keeps at most two
 * running, and skips hover, touch and idle loads on a constrained network.
 * Keyboard focus is the reader moving to the link to open it, so it preloads
 * even there. `cancel()` stops new loads (navigation started, or unmount);
 * `resume()` allows them again. Returns whether a preload started.
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
  const pending = new Set<string>();
  let cancelled = false;
  const start = (href: string, intent: PreloadIntent): boolean => {
    if (cancelled) return false;
    if (intent !== 'focus' && constrained()) return false;
    const key = preloadKey(href);
    const time = now();
    const at = recent.get(key);
    if (pending.has(key) || (at !== undefined && time - at < PRELOAD_FRESH_MS)) return false;
    if (pending.size >= MAX_PRELOADS_IN_FLIGHT) return false;
    pending.add(key);
    recent.delete(key);
    recent.set(key, time);
    while (recent.size > PRELOAD_MEMORY) recent.delete(recent.keys().next().value as string);
    void runSpeculative(() => preload(href))
      .catch(() => {
        // A failed preload is simply not cached: the click loads the page itself.
        recent.delete(key);
      })
      .finally(() => {
        pending.delete(key);
      });
    return true;
  };
  return Object.assign(start, {
    cancel: () => {
      cancelled = true;
    },
    resume: () => {
      cancelled = false;
    },
    /** Tests only. */
    size: () => recent.size,
  });
}
