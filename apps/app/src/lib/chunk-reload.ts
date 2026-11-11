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

import { claimDocumentRecovery, onlySpeculativeLoads } from '@/lib/document-recovery';

/** The chunk or stylesheet that failed, from the preload error's message, or the page as a fallback. */
function failedAsset(event: Event): string {
  const payload = (event as Event & { payload?: unknown }).payload;
  const message = payload instanceof Error ? payload.message : String(payload ?? '');
  return message.match(/https?:\/\/[^\s'"]+|\/[^\s'"]+\.(?:m?js|css)\b/)?.[0] ?? `page:${window.location.pathname}`;
}

function reloadOnChunkLoadFailure(event: Event): void {
  // A prefetch (a page the reader hasn't asked for) failed to load a chunk:
  // nothing on screen depends on it, so the page being read is never reloaded.
  // Cancelling keeps Vite from rethrowing into a prefetch nobody awaits; the
  // chunk is requested again if the reader opens that page.
  if (onlySpeculativeLoads()) {
    event.preventDefault();
    return;
  }
  // One budget with the reader's navigation fallback (lib/document-recovery.ts):
  // the same chunk failing again after a reload never reloads twice, a session
  // never reloads more than a couple of times, and one failure never triggers
  // two recoveries.
  if (!claimDocumentRecovery(`chunk:${failedAsset(event)}`)) return;
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
