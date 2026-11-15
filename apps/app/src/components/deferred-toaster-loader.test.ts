import { afterEach, describe, expect, it, vi } from 'vitest';

const recovery = vi.hoisted(() => ({ speculative: vi.fn(<T>(load: () => Promise<T>) => load()) }));
vi.mock('@/lib/document-recovery', () => ({ runSpeculative: recovery.speculative }));
// The chunk fails to download (offline, or removed by a deploy).
vi.mock('@nibleaf/design-system/components/ui/sonner', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

import { loadDeferredToaster } from './deferred-toaster-loader';

afterEach(() => recovery.speculative.mockClear());

describe('loadDeferredToaster', () => {
  it('loads as a speculative load, so a failed chunk never reloads the page', async () => {
    await loadDeferredToaster();
    expect(recovery.speculative).toHaveBeenCalledTimes(1);
  });

  it('resolves to null instead of throwing when the chunk fails', async () => {
    await expect(loadDeferredToaster()).resolves.toBeNull();
  });

  it('resolves to null when the recovery listener cancelled the error and Vite resolved the import to nothing', async () => {
    recovery.speculative.mockImplementationOnce(async () => undefined as never);
    await expect(loadDeferredToaster()).resolves.toBeNull();
  });
});
