// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import { GeneralSection } from './general-section';
import { ConfigDirtyProvider } from './shared';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ data: [] }),
  useUpdateProject: () => ({ mutate: mocks.mutate }),
  useUpdateLanguage: () => ({ mutateAsync: vi.fn() }),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.clearAllMocks());

it('preserves newer text and the dirty guard when a delayed save completes', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const dirty = new Set<string>();
  const report = (id: string, changed: boolean) => {
    if (changed) dirty.add(id);
    else dirty.delete(id);
  };
  const project = { id: 'site-1', name: 'Original', slug: 'docs', description: null, icon: null } as Project;
  try {
    await act(async () =>
      root.render(
        <ConfigDirtyProvider report={report}>
          <GeneralSection project={project} />
        </ConfigDirtyProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>('#set-name');
    if (!input) throw new Error('Site name input missing');
    const change = async (text: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await change('A');
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ name: 'A' }), expect.anything());
    await change('B');
    await act(async () => {
      mocks.mutate.mock.lastCall?.[1].onSuccess();
    });
    expect(input.value).toBe('B');
    expect(dirty.size).toBeGreaterThan(0);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    // The next save persists B and clears the guard when nothing newer is typed.
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(mocks.mutate.mock.lastCall?.[0].name).toBe('B');
    await act(async () => {
      mocks.mutate.mock.lastCall?.[1].onSuccess();
    });
    expect(input.value).toBe('B');
    expect(dirty.size).toBe(0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
