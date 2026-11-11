import { type ComponentProps, type ReactNode, use, useEffect, useId, useState, useSyncExternalStore } from 'react';

/*
 * Code-split modules that server-rendered markup depends on.
 *
 * `React.lazy` suspends on its first render even when its chunk has already
 * loaded. While hydrating, a suspended Suspense boundary keeps its server HTML
 * only until something above it re-renders or a context it sits under changes.
 * React then renders the boundary on the client, shows its fallback and drops
 * the server HTML. On published docs that blanked the article body for as long
 * as its chunk took to load (READER-03).
 *
 * A hydration module is read synchronously once loaded, so it renders in the
 * hydrating pass. Its markup carries `data-hydration-module="<key>"`, and the
 * router's `hydrate` hook loads every module whose key it finds in the server
 * HTML before React hydrates (see router.tsx). Pages that never render a
 * module's markup never download it.
 *
 * Nothing here imports during render, and nothing here rejects into React. A
 * `HydrationIsland` (below) renders a module's
 * content: until the module loads it keeps the server's HTML as it is, and it
 * starts the module's bounded retry.
 */

/** Marks server markup that needs a code-split module to hydrate. */
export const HYDRATION_MODULE_ATTRIBUTE = 'data-hydration-module';

/** `idle`: not loaded and nothing in flight. `failed`: the bounded retry ran
 *  out; only an explicit `retry({ again: true })` tries again. */
export type HydrationModuleStatus = 'idle' | 'loading' | 'loaded' | 'failed';

/** Waits before each retry after a failed download: four attempts at most. */
export const HYDRATION_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 9000];

export interface HydrationModule<T> {
  key: string;
  /** One download attempt (or the one in flight). The router's hook and the
   *  reader's loaders call it; callers handle the rejection. */
  load: () => Promise<T>;
  /** Downloads with backoff (`HYDRATION_RETRY_DELAYS_MS`), at most once until
   *  it succeeds unless `again` is set. Never rejects: `undefined` if it gave up. */
  retry: (options?: { again?: boolean }) => Promise<T | undefined>;
  status: () => HydrationModuleStatus;
  /** The loaded module. Only call it once `status()` is `loaded`. */
  read: () => T;
  subscribe: (listener: () => void) => () => void;
  /** Spread on the markup this module renders. */
  marker: { [HYDRATION_MODULE_ATTRIBUTE]: string };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function hydrationModule<T>(key: string, importer: () => Promise<T>): HydrationModule<T> {
  let status: HydrationModuleStatus = 'idle';
  let value: T | undefined;
  let attempt: Promise<T> | undefined;
  let retrying: Promise<T | undefined> | undefined;
  let attempted = false;
  const listeners = new Set<() => void>();
  const setStatus = (next: HydrationModuleStatus) => {
    if (status === next) return;
    status = next;
    for (const listener of listeners) listener();
  };
  const download = () => {
    attempted = true;
    attempt ??= importer().then(
      (loaded) => {
        value = loaded;
        setStatus('loaded');
        return loaded;
      },
      (error: unknown) => {
        attempt = undefined;
        throw error;
      },
    );
    return attempt;
  };
  const load = () => {
    if (status === 'loaded') return Promise.resolve(value as T);
    setStatus('loading');
    return download().catch((error: unknown) => {
      if (!retrying) setStatus('idle');
      throw error;
    });
  };
  const retry = ({ again = false } = {}) => {
    if (status === 'loaded') return Promise.resolve(value);
    if (retrying) return retrying;
    if (status === 'failed' && !again) return Promise.resolve(undefined);
    setStatus('loading');
    // A first or reader-requested attempt goes at once; after a failure, each
    // retry waits longer.
    const delays = attempted && !again ? HYDRATION_RETRY_DELAYS_MS : [0, ...HYDRATION_RETRY_DELAYS_MS];
    const inFlight = attempt;
    retrying = (async () => {
      if (inFlight) {
        try {
          return await inFlight;
        } catch {
          // Then retry with backoff.
        }
      }
      for (const delay of delays) {
        if (delay) await wait(delay);
        try {
          return await download();
        } catch {
          // The next attempt, if any, waits longer.
        }
      }
    })().finally(() => {
      retrying = undefined;
      if (status !== 'loaded') setStatus('failed');
    });
    return retrying;
  };
  return {
    key,
    load,
    retry,
    status: () => status,
    read: () => {
      if (status !== 'loaded') throw new Error(`Hydration module "${key}" read before it loaded`);
      return value as T;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    marker: { [HYDRATION_MODULE_ATTRIBUTE]: key },
  };
}

/** Loads each of `modules` whose markup is in the server HTML under `root`.
 *  Never rejects: a module that fails to load leaves its server HTML in place,
 *  and its island retries. */
export async function loadServerRenderedModules(root: ParentNode, modules: ReadonlyArray<HydrationModule<unknown>>): Promise<void> {
  await Promise.all(
    modules
      .filter((module) => root.querySelector(`[${HYDRATION_MODULE_ATTRIBUTE}="${module.key}"]`))
      .map((module) => module.load().catch(() => undefined)),
  );
}

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
  // Nothing here is worth memoizing (callers pass module-level module lists),
  // and the compiler's cache would double this reader-critical chunk.
  'use no memo';
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
