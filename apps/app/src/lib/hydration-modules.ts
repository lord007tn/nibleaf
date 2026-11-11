import { use } from 'react';

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
 * hydrating pass. The markup it renders carries `data-hydration-module="<key>"`,
 * and the router's `hydrate` hook loads every module whose key it finds in the
 * server HTML before React hydrates (see router.tsx). Pages that never render a
 * module's markup never download it.
 */

/** Marks server markup that needs a code-split module to hydrate. */
export const HYDRATION_MODULE_ATTRIBUTE = 'data-hydration-module';

export interface HydrationModule<T> {
  key: string;
  /** Starts (or joins) the download. A failed download can be retried. */
  load: () => Promise<T>;
  /** The loaded module, suspending only while it is still downloading. */
  useModule: () => T;
  /** Spread on the markup this module renders. */
  marker: { [HYDRATION_MODULE_ATTRIBUTE]: string };
}

export function hydrationModule<T>(key: string, importer: () => Promise<T>): HydrationModule<T> {
  let value: T | undefined;
  let pending: Promise<T> | undefined;
  const load = () => {
    pending ??= importer().then(
      (loaded) => {
        value = loaded;
        return loaded;
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  return {
    key,
    load,
    // `use` may be called conditionally; a loaded module never reaches it.
    useModule: () => value ?? use(load()),
    marker: { [HYDRATION_MODULE_ATTRIBUTE]: key },
  };
}

/** Loads each module whose markup is in the server HTML under `root`. The
 *  declarations load only when some markup is marked, so pages without any
 *  (the dashboard, marketing) download nothing. Never rejects: a module that
 *  fails to load suspends its boundary as before, and that boundary retries. */
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
