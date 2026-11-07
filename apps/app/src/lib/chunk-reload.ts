/**
 * After a deploy, a tab still running the previous build can ask for hashed
 * chunks the server no longer serves. Vite's preload helper wraps every
 * dynamic `import()` in the client build: TanStack Router's split route
 * components and loaders, and the reader's lazy renderers. When the import, or
 * a CSS file it preloads, fails, the helper dispatches `vite:preloadError` on
 * `window`, then rethrows unless the event was cancelled. Reloading once
 * picks up the new build.
 *
 * The listener never cancels the event, so the error still reaches the
 * route's error component. That is what the person sees when the reload is
 * skipped.
 */

const RELOAD_KEY = 'nibleaf.chunk-reload';
/** Automatic reloads allowed in one tab session, whatever fails. */
const MAX_RELOADS_PER_SESSION = 2;

/** The chunk or stylesheet that failed, from the preload error's message, or the page as a fallback. */
function failedAsset(event: Event): string {
  const payload = (event as Event & { payload?: unknown }).payload;
  const message = payload instanceof Error ? payload.message : String(payload ?? '');
  return message.match(/https?:\/\/[^\s'"]+|\/[^\s'"]+\.(?:m?js|css)\b/)?.[0] ?? `page:${window.location.pathname}`;
}

function reloadOnChunkLoadFailure(event: Event): void {
  const asset = failedAsset(event);
  try {
    const raw = window.sessionStorage.getItem(RELOAD_KEY);
    const stored = raw ? (JSON.parse(raw) as { assets?: unknown } | null) : null;
    const reloadedFor = Array.isArray(stored?.assets) ? stored.assets.filter((value): value is string => typeof value === 'string') : [];
    // The same asset failing again means the reload didn't help, however long it took to fail;
    // and a session never reloads more than a couple of times, so nothing can loop.
    if (reloadedFor.includes(asset) || reloadedFor.length >= MAX_RELOADS_PER_SESSION) return;
    window.sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ assets: [...reloadedFor, asset], at: Date.now() }));
  } catch {
    // Without storage there's no loop guard, so don't reload automatically.
    return;
  }
  window.location.reload();
}

/** Registers the listener on the client. It's safe to call more than once:
 *  `addEventListener` ignores a listener that's already registered. */
export function reloadOnceOnChunkLoadFailure(): void {
  window.addEventListener('vite:preloadError', reloadOnChunkLoadFailure);
}

// In development, a re-evaluated module would otherwise leave its old listener attached.
if (import.meta.hot) {
  import.meta.hot.dispose(() => window.removeEventListener('vite:preloadError', reloadOnChunkLoadFailure));
}
