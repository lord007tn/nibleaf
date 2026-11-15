import { runSpeculative } from '@/lib/document-recovery';

/** Loads sonner's toast host, or resolves to null if it can't. The host is
 *  optional, so its download never costs the page: `runSpeculative` keeps the
 *  chunk-recovery listener (lib/chunk-reload.ts) from reloading the page over
 *  it, which also means Vite resolves the import to nothing instead of throwing;
 *  any other failure resolves to null too. Its own module so tests can fail it. */
export const loadDeferredToaster = () =>
  runSpeculative(() => import('@nibleaf/design-system/components/ui/sonner')).then(
    (module) => module?.Toaster ?? null,
    () => null,
  );
