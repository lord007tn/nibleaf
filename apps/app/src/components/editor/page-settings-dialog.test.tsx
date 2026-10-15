/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api/types';
import { PageSettingsDialog } from './page-settings-dialog';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/api', () => ({ useUpdatePage: () => ({ isPending: false, mutate: vi.fn() }) }));

const page: PageNode = {
  id: 'page-a',
  parentId: null,
  languageId: 'en',
  kind: 'PAGE',
  title: 'Original title',
  slug: 'original',
  path: 'original',
  icon: null,
  description: null,
  position: 0,
  hidden: false,
  updatedAt: '2026-10-15T00:00:00Z',
};

describe('page settings draft', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('preserves typed settings when an autosave refreshes the same page', async () => {
    const render = (nextPage: PageNode) => root.render(<PageSettingsDialog onOpenChange={vi.fn()} open page={nextPage} projectId="project-a" />);
    await act(async () => render(page));
    const title = document.querySelector<HTMLInputElement>('#page-title');
    if (!title) throw new Error('Page title input was not rendered');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(title, 'Unsaved dialog title');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(title.value).toBe('Unsaved dialog title');
    await act(async () => render({ ...page, title: 'Autosaved title', updatedAt: '2026-10-15T00:01:00Z' }));
    expect(document.querySelector<HTMLInputElement>('#page-title')?.value).toBe('Unsaved dialog title');
    await act(async () => render({ ...page, id: 'page-b', title: 'Other page' }));
    expect(document.querySelector<HTMLInputElement>('#page-title')?.value).toBe('Other page');
  });
});
