import { config } from 'zod/v4/core';

/**
 * Turns off zod's JIT in the browser. On first object parse zod probes for
 * `eval` support with `Function("")` inside a try/catch. The site's CSP has no
 * `unsafe-eval`, so the probe throws (and zod falls back), but the browser still
 * reports a CSP violation on every page (READER-23). Under `jitless` zod skips
 * the probe and uses its regular interpreter, which is what it ends up using
 * under this CSP anyway.
 *
 * The probe's result is cached on the first parse, and some modules parse while
 * they load (environment schemas), so this runs as a side effect of importing
 * this module: `router.tsx` imports it first, before anything that uses zod.
 * The server keeps zod's JIT.
 */
export const disableZodJitForCsp = (): void => {
  config({ jitless: true });
};

if (typeof document !== 'undefined') disableZodJitForCsp();
