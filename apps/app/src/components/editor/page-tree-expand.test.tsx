/** @vitest-environment jsdom */
/** A large tree expands and collapses correctly. Timing lives in `page-tree-performance.bench.tsx`. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LargeTree, largeTreePages } from './page-tree-large-fixture';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('expands and collapses a group of 120 pages in a 313-page site', async () => {
  localStorage.setItem('nibleaf.editor.collapsedGroups:en', '["page-0"]');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LargeTree pages={largeTreePages()} onAction={vi.fn()} />));
    const englishRows = () => container.querySelectorAll('[role="treeitem"][aria-level="2"]').length;
    expect(englishRows()).toBe(0);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click());
    expect(englishRows()).toBe(120);
    expect(container.textContent).toContain('Page 120');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.click());
    expect(englishRows()).toBe(0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
  }
});
