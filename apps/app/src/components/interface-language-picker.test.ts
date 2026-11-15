import { afterEach, describe, expect, it, vi } from 'vitest';

const recovery = vi.hoisted(() => ({ speculative: vi.fn(<T>(load: () => Promise<T>) => load()) }));
vi.mock('@/lib/document-recovery', () => ({ runSpeculative: recovery.speculative }));
vi.mock('@/components/interface-language-dialog', () => ({ InterfaceLanguageDialog: () => null }));

import { loadInterfaceLanguagePicker } from './interface-language-picker';

afterEach(() => recovery.speculative.mockClear());

describe('loadInterfaceLanguagePicker', () => {
  it('loads as a speculative load, so a failed chunk never reloads the page', async () => {
    await expect(loadInterfaceLanguagePicker()).resolves.toBeTypeOf('function');
    expect(recovery.speculative).toHaveBeenCalledTimes(1);
  });

  it('rejects, so the button shows its fallback, when the recovery listener cancelled the error and Vite resolved the import to nothing', async () => {
    recovery.speculative.mockImplementationOnce(async () => undefined as never);
    await expect(loadInterfaceLanguagePicker()).rejects.toThrow();
  });
});
