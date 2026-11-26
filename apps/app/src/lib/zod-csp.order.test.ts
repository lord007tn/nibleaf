// @vitest-environment jsdom
/**
 * #836: the order the browser loads things in. router.tsx imports `zod-csp` before anything that uses zod; this
 * file does the same in a module graph where zod has not loaded yet, and checks that zod never reaches `Function`
 * (its eval probe, or its JIT compiling a parser), which the site's CSP reports as a violation (READER-23).
 * zod-csp.test.ts imports zod first, so it can't show this.
 */
import { afterAll, expect, it } from 'vitest';

const zodGlobal = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
const NativeFunction = globalThis.Function;
const calls: string[] = [];
// Every `Function(...)` and `new Function(...)` from here on is counted, then made as usual.
globalThis.Function = new Proxy(NativeFunction, {
  apply(target, thisArg, args) {
    calls.push(String(args.at(-1) ?? ''));
    return Reflect.apply(target, thisArg, args);
  },
  construct(target, args, newTarget) {
    calls.push(String(args.at(-1) ?? ''));
    return Reflect.construct(target, args, newTarget === globalThis.Function ? target : newTarget);
  },
});

afterAll(() => {
  globalThis.Function = NativeFunction;
});

it('turns the JIT off before zod first loads, so parsing an object never calls Function', async () => {
  // Nothing in this module graph has loaded zod yet: it would have created its global config.
  expect(zodGlobal.__zod_globalConfig).toBeUndefined();
  await import('./zod-csp');
  expect(zodGlobal.__zod_globalConfig?.jitless).toBe(true);
  const { z } = await import('zod');
  // zod adopted the object the setup made, rather than replacing it.
  const { config } = await import('zod/v4/core');
  expect(config()).toBe(zodGlobal.__zod_globalConfig);

  const schema = z.object({ name: z.string(), count: z.number().optional(), tags: z.array(z.string()) });
  for (let parse = 0; parse < 3; parse += 1) expect(schema.parse({ name: 'docs', tags: ['a'] })).toEqual({ name: 'docs', tags: ['a'] });
  expect(z.object({ nested: schema }).safeParse({ nested: { name: 1 } }).success).toBe(false);
  expect(calls).toEqual([]);

  // The counter does see zod's use of Function: with the JIT on, a new object schema probes and compiles.
  config({ jitless: false });
  z.object({ name: z.string() }).parse({ name: 'docs' });
  expect(calls.length).toBeGreaterThan(0);
  config({ jitless: true });
});
