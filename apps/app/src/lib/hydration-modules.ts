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
 * `HydrationIsland` (components/hydration-island.tsx) renders a module's
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

/** Loads each module whose markup is in the server HTML under `root`. The
 *  declarations load only when some markup is marked, so pages without any
 *  (the dashboard, marketing) download nothing. Never rejects: a module that
 *  fails to load leaves its server HTML in place, and its island retries. */
export async function loadServerRenderedModules(
  root: ParentNode,
  declarations: () => Promise<ReadonlyArray<HydrationModule<unknown>>>,
): Promise<void> {
  if (!root.querySelector(`[${HYDRATION_MODULE_ATTRIBUTE}]`)) return;
  const modules = await declarations().catch(() => []);
  await Promise.all(
    modules
      .filter((module) => root.querySelector(`[${HYDRATION_MODULE_ATTRIBUTE}="${module.key}"]`))
      .map((module) => module.load().catch(() => undefined)),
  );
}
