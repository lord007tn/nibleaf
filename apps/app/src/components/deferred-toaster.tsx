import type { Toaster as SonnerToaster } from '@nibleaf/design-system/components/ui/sonner';
import type { ComponentProps, ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { loadDeferredToaster } from '@/components/deferred-toaster-loader';

// The toast host and the `sonner` package load after hydration, once the
// browser is idle, so they leave the sign-in and sign-up pages' first load.
// Nothing is lost meanwhile: sonner keeps its toasts at module level and a
// Toaster that mounts later shows every toast still active (sonner 2.0.8's
// `Observer.subscribe` replays them), so `toast()` works before this resolves.
// If the host can't load (offline, or a deploy removed the chunk), the page
// stays exactly as it is: toasts just don't show, as before they were sent.

type ToasterProps = ComponentProps<typeof SonnerToaster>;

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
  const [host, setHost] = useState<{ Toaster: ComponentType<ToasterProps> } | null>(null);
  useEffect(() => {
    let active = true;
    const cancel = whenIdle(() => {
      loadDeferredToaster().then(
        (Toaster) => {
          if (active && Toaster) setHost({ Toaster });
        },
        () => undefined,
      );
    });
    return () => {
      active = false;
      cancel();
    };
  }, []);
  return host ? <host.Toaster {...props} /> : null;
}
