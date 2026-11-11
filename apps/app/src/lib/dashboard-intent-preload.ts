import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

type DashboardPreloads = Record<string, readonly string[]>;

const PRELOADS_URL = '/dashboard-preloads.json';

// Module state: the shell can remount (sign-out and back), but the manifest and
// the links already in <head> outlive it.
let preloads: DashboardPreloads | null = null;
let manifestRequest: Promise<void> | null = null;
const injected = new Set<string>();
const handledPaths = new Set<string>();

function loadManifest() {
  // The file's name has no hash, so it is served outside `/assets/` with a short,
  // revalidated cache (vite.config.ts); asking for revalidation here as well keeps a
  // stale copy out even within that minute (a 304 when unchanged). A per-build query
  // string would instead rename reader chunks on every build, since the shell chunk
  // that carries it is listed in the router's eager chunk.
  manifestRequest ??= fetch(PRELOADS_URL, { cache: 'no-cache' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: unknown) => {
      if (data && typeof data === 'object' && !Array.isArray(data)) preloads = data as DashboardPreloads;
    })
    // The router's own route loading still works; this only starts it sooner.
    .catch(() => undefined);
  return manifestRequest;
}

function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, { timeout: 2000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 1);
  return () => window.clearTimeout(handle);
}

function preloadModule(href: string) {
  if (injected.has(href)) return;
  injected.add(href);
  const link = document.createElement('link');
  link.rel = 'modulepreload';
  link.href = href;
  document.head.appendChild(link);
}

/** Same-origin `/app…` path of the link an intent event is over, if any. */
function dashboardPath(target: EventTarget | null): string | null {
  const anchor = target instanceof Element ? target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  return url.pathname === '/app' || url.pathname.startsWith('/app/') ? url.pathname : null;
}

/**
 * Preloads every chunk a dashboard link's route needs when the pointer or focus
 * reaches it. Dashboard route chunks have no preload list in the router's eager
 * chunk (it ships to published docs too; scripts/dashboard-preload-plugin.ts),
 * so the router's intent preload alone would fetch a route chunk's imports one
 * level at a time. The build writes each dashboard route's full chunk list to
 * `/dashboard-preloads.json`; this reads it once, when the browser is
 * idle, and adds `<link rel="modulepreload">` for the routes a link matches.
 * Production only: in development there is no such file. Use it once, in the
 * signed-in shell; published docs pages never import this module.
 */
export function useDashboardIntentPreload() {
  const router = useRouter();
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const cancelIdle = whenIdle(() => void loadManifest());
    const onIntent = (event: Event) => {
      if (!preloads) return;
      const pathname = dashboardPath(event.target);
      if (!pathname || handledPaths.has(pathname)) return;
      handledPaths.add(pathname);
      try {
        const [routes] = router.getMatchedRoutes(pathname);
        for (const route of routes) for (const href of preloads[route.id] ?? []) preloadModule(href);
      } catch {
        // An unmatched or malformed path: leave it to the router.
      }
    };
    document.addEventListener('pointerover', onIntent, true);
    document.addEventListener('focusin', onIntent, true);
    return () => {
      cancelIdle();
      document.removeEventListener('pointerover', onIntent, true);
      document.removeEventListener('focusin', onIntent, true);
    };
  }, [router]);
}
