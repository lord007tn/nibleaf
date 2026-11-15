import { afterEach, describe, expect, it, vi } from 'vitest';

const recovery = vi.hoisted(() => ({ optional: vi.fn(<T>(load: () => Promise<T>) => load()) }));
vi.mock('@/lib/document-recovery', () => ({ runOptionalLoad: recovery.optional }));
// The chunk fails to download (offline, or removed by a deploy).
vi.mock('@nibleaf/design-system/components/ui/sonner', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

import { loadDeferredToaster } from './deferred-toaster-loader';

afterEach(() => recovery.optional.mockClear());

describe('loadDeferredToaster', () => {
  it('loads as an optional load, so its own failed chunk never reloads the page', async () => {
    await loadDeferredToaster();
    expect(recovery.optional).toHaveBeenCalledTimes(1);
  });

  it('resolves to null instead of throwing when the chunk fails', async () => {
    await expect(loadDeferredToaster()).resolves.toBeNull();
  });

  it('resolves to null when the module comes back without the host', async () => {
    recovery.optional.mockImplementationOnce(async () => undefined as never);
    await expect(loadDeferredToaster()).resolves.toBeNull();
  });
});
