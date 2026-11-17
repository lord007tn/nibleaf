import { afterEach, describe, expect, it } from 'vitest';
import { config } from 'zod/v4/core';
import { disableZodJitForCsp } from './zod-csp';

afterEach(() => {
  config({ jitless: false });
});

describe('disableZodJitForCsp', () => {
  it("turns zod's JIT off, so it never probes eval under the site CSP", () => {
    config({ jitless: false });
    disableZodJitForCsp();
    expect(config().jitless).toBe(true);
  });

  it("writes zod's own config object, which zod keeps on globalThis for every copy", () => {
    // zod adopts this object when it loads (`globalThis.__zod_globalConfig ??= {}`),
    // so the flag holds whether zod loads before this module or after it.
    expect(config()).toBe((globalThis as { __zod_globalConfig?: object }).__zod_globalConfig);
  });
});
