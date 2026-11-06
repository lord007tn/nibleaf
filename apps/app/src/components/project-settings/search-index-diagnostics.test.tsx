// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  data: { availability: { reason: 'provider_unavailable' as string | null }, health: 'unavailable' },
  mutate: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: state.toastError } }));
vi.mock('@/hooks/api', () => ({
  useProjectSearchIndexDiagnostics: () => ({ data: state.data, isPending: false, isError: false }),
  useCreateProjectSearchReindex: () => ({ isPending: false, mutateAsync: state.mutate }),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@nibleaf/i18n', () => ({ getLocale: () => 'en' }));

import { SearchIndexDiagnostics } from './search-index-diagnostics';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});
describe('index recovery controls', () => {
  it.each([
    ['provider_unavailable', false],
    ['not_configured', true],
    ['not_published', true],
  ])('keeps reindex recovery %s truthful', async (reason, disabled) => {
    state.data = { availability: { reason }, health: 'unavailable' };
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<SearchIndexDiagnostics projectId="qa-project" />));
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('settings.search.diagnostics.reindex'));
    expect(button?.disabled).toBe(disabled);
    if (!disabled) {
      await act(async () => button?.click());
      expect(state.mutate).toHaveBeenCalledOnce();
    }
  });
  it('reports a failed reindex in plain words, never the server text', async () => {
    state.data = { availability: { reason: 'provider_unavailable' }, health: 'unavailable' };
    state.mutate.mockRejectedValueOnce(new Error('PrismaClientKnownRequestError: Unique constraint failed'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<SearchIndexDiagnostics projectId="qa-project" />));
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('settings.search.diagnostics.reindex'));
    await act(async () => button?.click());
    expect(state.toastError).toHaveBeenCalledExactlyOnceWith('settings.search.diagnostics.reindexError');
    quiet.mockRestore();
  });
});
