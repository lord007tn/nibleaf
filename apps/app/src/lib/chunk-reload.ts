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
/** A failure this soon after the last automatic reload means the reload didn't help. */
const RELOAD_GUARD_MS = 30_000;

function reloadOnChunkLoadFailure(): void {
  const now = Date.now();
  try {
    const raw = window.sessionStorage.getItem(RELOAD_KEY);
    const last = raw ? (JSON.parse(raw) as { at?: unknown } | null) : null;
    if (typeof last?.at === 'number' && now >= last.at && now - last.at < RELOAD_GUARD_MS) return;
    // The page path tells anyone inspecting storage where the failure happened.
    window.sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ at: now, path: window.location.pathname }));
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
