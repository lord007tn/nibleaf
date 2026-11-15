import type { ComponentProps } from 'react';
import { lazy, Suspense, useEffect, useState } from 'react';

// The toast host and the `sonner` package load after hydration, once the
// browser is idle, so they leave the sign-in and sign-up pages' first load.
// Nothing is lost meanwhile: sonner keeps its toasts at module level and a
// Toaster that mounts later shows every toast still active (sonner 2.0.8's
// `Observer.subscribe` replays them), so `toast()` works before this resolves.
const Toaster = lazy(() => import('@nibleaf/design-system/components/ui/sonner').then((module) => ({ default: module.Toaster })));

type ToasterProps = ComponentProps<typeof Toaster>;

function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, { timeout: 2000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 1);
  return () => window.clearTimeout(handle);
}

/** sonner's Toaster, mounted on the client after hydration when the browser is idle. */
export function DeferredToaster(props: ToasterProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => whenIdle(() => setReady(true)), []);
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <Toaster {...props} />
    </Suspense>
  );
}
