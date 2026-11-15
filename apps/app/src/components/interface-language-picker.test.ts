import { afterEach, describe, expect, it, vi } from 'vitest';

const recovery = vi.hoisted(() => ({ optional: vi.fn(<T>(load: () => Promise<T>) => load()) }));
vi.mock('@/lib/document-recovery', () => ({ runOptionalLoad: recovery.optional }));
vi.mock('@/components/interface-language-dialog', () => ({ InterfaceLanguageDialog: () => null }));

import { loadInterfaceLanguagePicker } from './interface-language-picker';

afterEach(() => recovery.optional.mockClear());

describe('loadInterfaceLanguagePicker', () => {
  it('loads as an optional load, so its own failure never reloads the page', async () => {
    await expect(loadInterfaceLanguagePicker()).resolves.toBeTypeOf('function');
    expect(recovery.optional).toHaveBeenCalledTimes(1);
  });

  it('rejects, so the button shows its fallback, when the import fails', async () => {
    recovery.optional.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    await expect(loadInterfaceLanguagePicker()).rejects.toThrow();
  });

  it('rejects when the module comes back without the dialog', async () => {
    recovery.optional.mockImplementationOnce(async () => undefined as never);
    await expect(loadInterfaceLanguagePicker()).rejects.toThrow();
  });
});
