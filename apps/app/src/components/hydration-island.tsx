import { type ComponentProps, type ReactNode, use, useEffect, useId, useState, useSyncExternalStore } from 'react';
import type { HydrationModule, HydrationModuleStatus } from '@/lib/hydration-modules';

const ISLAND_ATTRIBUTE = 'data-hydration-island';

/** `loaded` once every module has, `failed` once any gave up. */
const combinedStatus = (modules: ReadonlyArray<HydrationModule<unknown>>): HydrationModuleStatus => {
  const statuses = modules.map((module) => module.status());
  if (statuses.every((status) => status === 'loaded')) return 'loaded';
  if (statuses.includes('failed')) return 'failed';
  return statuses.includes('loading') ? 'loading' : 'idle';
};

/** This island's server HTML, read before React touches it. */
const serverHtmlOf = (id: string): string | null => {
  for (const node of document.querySelectorAll(`[${ISLAND_ATTRIBUTE}]`)) {
    if (node.getAttribute(ISLAND_ATTRIBUTE) === id) return node.innerHTML;
  }
  return null;
};

/**
 * Renders content that needs code-split `modules`, inside a `div` that takes
 * the remaining props.
 *
 * Once the modules have loaded, `children()` renders. The router loads them
 * before hydrating a page whose server HTML marks them, and the reader's
 * loaders before navigating, so that is the normal case. Until then:
 * - **Hydrating:** the server's HTML stays exactly as sent. React doesn't
 *   hydrate inside it, and nothing suspends, so nothing above can swap it for a
 *   fallback. The content becomes interactive when the modules load.
 * - **Client render (navigation):** `pending`, then `failed` once the retries
 *   ran out. Neither reaches the route's error boundary.
 * Either way the modules retry with a bounded backoff, from an effect.
 * On the server the island waits for its modules, so the HTML has the content.
 */
export function HydrationIsland({
  modules,
  children,
  pending = null,
  failed = () => null,
  keepServerHtmlOnFailure = true,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  modules: ReadonlyArray<HydrationModule<unknown>>;
  children: () => ReactNode;
  pending?: ReactNode;
  /** Rendered once the retries ran out; `retry` tries again. */
  failed?: (retry: () => void) => ReactNode;
  /** Whether server HTML stays once the retries ran out (content), or gives way
   *  to `failed` (controls that do nothing without their code). */
  keepServerHtmlOnFailure?: boolean;
}) {
  const id = useId();
  const subscribe = (listener: () => void) => {
    const unsubscribes = modules.map((module) => module.subscribe(listener));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  };
  const getStatus = () => combinedStatus(modules);
  const status = useSyncExternalStore(subscribe, getStatus, getStatus);
  if (status !== 'loaded' && typeof window === 'undefined') {
    // Server only: the HTML must carry the content, so wait for the modules.
    use(Promise.all(modules.map((module) => module.load())));
  }
  // Read once, while the server's markup is still untouched. A client render
  // that isn't hydrating finds nothing.
  const [serverHtml] = useState(() => (status === 'loaded' || typeof document === 'undefined' ? null : serverHtmlOf(id)));

  useEffect(() => {
    if (status === 'idle') {
      for (const module of modules) void module.retry();
    }
  }, [status, modules]);

  const island = { ...props, [ISLAND_ATTRIBUTE]: id };
  if (status === 'loaded') {
    return (
      <div key="live" {...island}>
        {children()}
      </div>
    );
  }
  if (serverHtml !== null && (status !== 'failed' || keepServerHtmlOnFailure)) {
    // The exact markup React would hydrate, set as HTML: React leaves it as is.
    // biome-ignore lint/security/noDangerouslySetInnerHtml: the server's own rendered (sanitized) markup, read back from this element unchanged.
    return <div key="server" {...island} dangerouslySetInnerHTML={{ __html: serverHtml }} suppressHydrationWarning />;
  }
  const retry = () => {
    for (const module of modules) void module.retry({ again: true });
  };
  return (
    <div key="client" {...island}>
      {status === 'failed' ? failed(retry) : pending}
    </div>
  );
}
