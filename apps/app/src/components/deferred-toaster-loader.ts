import { runOptionalLoad } from '@/lib/document-recovery';

/** Loads sonner's toast host, or resolves to null if it can't. The host is
 *  optional, so its download never costs the page: `runOptionalLoad` claims this
 *  load's own failure, so the chunk-recovery listener (lib/chunk-reload.ts)
 *  doesn't reload the page over it, while a different chunk failing meanwhile
 *  still recovers as usual. A failure, or a module without the host, resolves
 *  to null. Its own module so tests can fail it. */
export const loadDeferredToaster = () =>
  runOptionalLoad(() => import('@nibleaf/design-system/components/ui/sonner')).then(
    (module) => module?.Toaster ?? null,
    () => null,
  );
