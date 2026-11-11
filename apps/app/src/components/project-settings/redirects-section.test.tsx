/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import { RedirectsSection } from './redirects-section';

const mocks = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/api', () => ({ useUpdateProjectConfig: () => ({}) }));
vi.mock('./shared', () => ({
  FIELD_COMPACT_MONO: '',
  SectionHeader: () => null,
  SaveBar: () => <button type="submit">Save</button>,
  saveConfigSection: mocks.save,
  useDraftRowUndo: () => ({ offerUndo: vi.fn(), clearUndo: vi.fn() }),
}));

it('council: redirect settings preserve generated provenance until the writer edits a rule', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const project = { id: 'project', config: { redirects: [{ from: '/old', to: '/new', generated: true }] } } as Project;
  try {
    await act(async () => root.render(<RedirectsSection project={project} />));
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save');
    await act(async () => save?.click());
    expect(mocks.save).toHaveBeenLastCalledWith(expect.anything(), { redirects: [{ from: '/old', to: '/new', generated: true }] });
    const target = container.querySelector<HTMLInputElement>('input[aria-label="settings.redirects.toLabel"]');
    if (!target) throw new Error('Redirect destination was not rendered');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(target, 'https://example.com/custom');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => save?.click());
    expect(mocks.save).toHaveBeenLastCalledWith(expect.anything(), {
      redirects: [{ from: '/old', to: 'https://example.com/custom', generated: false }],
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
