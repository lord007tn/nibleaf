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
});
