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
 *
 * It sets the flag on the config object zod keeps on `globalThis` (shared by
 * every copy of zod, and adopted by one that loads later) rather than through
 * `config()`: importing zod here would put part of it in the router's entry,
 * which published docs pages load and no longer otherwise need (PUB-017).
 */
const zodGlobal = globalThis as { __zod_globalConfig?: { jitless?: boolean } };

export const disableZodJitForCsp = (): void => {
  zodGlobal.__zod_globalConfig ??= {};
  zodGlobal.__zod_globalConfig.jitless = true;
};

if (typeof document !== 'undefined') disableZodJitForCsp();
