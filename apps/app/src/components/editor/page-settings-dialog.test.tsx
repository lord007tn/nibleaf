/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api/types';
import { PageSettingsDialog } from './page-settings-dialog';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
const mocks = vi.hoisted(() => ({ reorder: vi.fn(), confirm: vi.fn() }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: () => 'error',
  useUpdatePage: () => ({ isPending: false, mutate: vi.fn() }),
  useReorderPages: () => ({ isPending: false, mutate: mocks.reorder }),
}));
vi.mock('@nibleaf/design-system/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (value: string) => void }) => (
    <select data-testid="select" value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));

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

  it('moves the page and its subtree to the chosen language after confirming', async () => {
    const child: PageNode = { ...page, id: 'child', parentId: 'page-a', slug: 'child', path: 'original/child' };
    const arabicTop: PageNode = { ...page, id: 'ar-top', languageId: 'ar', slug: 'muqaddima', path: 'muqaddima', position: 4 };
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () =>
      root.render(
        <PageSettingsDialog
          languages={[
            { id: 'en', label: 'English' },
            { id: 'ar', label: 'العربية' },
          ]}
          onOpenChange={vi.fn()}
          open
          page={page}
          pages={[page, child, arabicTop]}
          projectId="project-a"
        />,
      ),
    );
    const language = document.querySelector<HTMLSelectElement>('#page-language, [data-testid="select"]');
    if (!language) throw new Error('Language select was not rendered');
    const choose = async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(language, value);
        language.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await choose('ar');
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: 'editor.pageSettings.moveLanguage.descriptionWithChildren' }));
    expect(mocks.reorder).not.toHaveBeenCalled();
    await choose('ar');
    expect(mocks.reorder).toHaveBeenCalledWith(
      {
        items: [
          { id: 'page-a', parentId: null, position: 5, languageId: 'ar' },
          { id: 'child', parentId: 'page-a', position: 0, languageId: 'ar' },
        ],
      },
      expect.any(Object),
    );
  });
});
