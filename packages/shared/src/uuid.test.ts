import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUUID', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when the context provides it', () => {
    const native = vi.fn(() => '00000000-0000-4000-8000-000000000000');
    vi.stubGlobal('crypto', { randomUUID: native, getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    expect(randomUUID()).toBe('00000000-0000-4000-8000-000000000000');
    expect(native).toHaveBeenCalledOnce();
  });

  it('works in an insecure context, where crypto.randomUUID is undefined', () => {
    // A self-hoster serving the reader over plain http on a LAN address.
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    expect(globalThis.crypto.randomUUID).toBeUndefined();
    const ids = Array.from({ length: 1000 }, () => randomUUID());
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
