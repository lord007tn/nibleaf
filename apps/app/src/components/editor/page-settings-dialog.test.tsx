/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api/types';
import { PageSettingsDialog } from './page-settings-dialog';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => mocks.translate }));
const mocks = vi.hoisted(() => ({ reorder: vi.fn(), confirm: vi.fn(), update: vi.fn(), success: vi.fn(), translate: vi.fn((key: string) => key) }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: vi.fn() } }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: () => 'error',
  useUpdatePage: () => ({ isPending: false, mutate: mocks.update }),
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

  it.each([
    [{ addressChanged: true, redirectsAdded: 1, linksUpdated: 2 }, 'editor.pageSettings.addressChanged'],
    [{ addressChanged: false, redirectsAdded: 0, linksUpdated: 0 }, 'editor.pageSettings.saved'],
  ])('shows the server address-change feedback after saving: %s', async (result, message) => {
    const close = vi.fn();
    await act(async () => root.render(<PageSettingsDialog onOpenChange={close} open page={page} projectId="project-a" />));
    const save = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('editor.pageSettings.save'));
    if (!save) throw new Error('Save button was not rendered');
    await act(async () => save.click());
    const options = mocks.update.mock.calls.at(-1)?.[1] as { onSuccess: (data: typeof result) => void };
    await act(async () => options.onSuccess(result));
    expect(mocks.success).toHaveBeenLastCalledWith(message);
    if (result.addressChanged) expect(mocks.translate).toHaveBeenCalledWith(message, { path: '/original', redirects: 1, links: 2 });
    expect(close).toHaveBeenLastCalledWith(false);
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

  describe('after a language move finishes', () => {
    const linked: PageNode = { ...page, translationKey: 'shared' };
    const setValue = async (selector: string, value: string) => {
      const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
      if (!input) throw new Error(`${selector} was not rendered`);
      const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      await act(async () => {
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      });
    };
    const openSeo = async () => {
      const tab = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('editor.pageSettings.tab.seo'));
      await act(async () => tab?.click());
    };
    const startMove = async () => {
      mocks.confirm.mockResolvedValueOnce(true);
      await act(async () =>
        root.render(
          <PageSettingsDialog
            languages={[
              { id: 'en', label: 'English' },
              { id: 'ar', label: 'العربية' },
            ]}
            onOpenChange={vi.fn()}
            open
            page={linked}
            pages={[linked]}
            projectId="project-a"
          />,
        ),
      );
      await setValue('[data-testid="select"]', 'ar');
      const options = mocks.reorder.mock.calls.at(-1)?.[1] as { onSuccess: (list: PageNode[]) => void };
      return (moved: Partial<PageNode>) => act(async () => options.onSuccess([{ ...linked, languageId: 'ar', ...moved }]));
    };

    it('shows the numbered address and the cleared translation key the server gave the page', async () => {
      const finish = await startMove();
      await finish({ slug: 'original-2', translationKey: null });
      expect(document.querySelector<HTMLInputElement>('#page-slug')?.value).toBe('original-2');
      await openSeo();
      expect(document.querySelector<HTMLInputElement>('#page-translation-key')?.value).toBe('');
    });

    it('keeps an address and a translation key edited while the move was pending', async () => {
      const finish = await startMove();
      await setValue('#page-slug', 'my-address');
      await openSeo();
      await setValue('#page-translation-key', 'my-key');
      await finish({ slug: 'original-2', translationKey: null });
      expect(document.querySelector<HTMLInputElement>('#page-translation-key')?.value).toBe('my-key');
      const general = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('editor.pageSettings.tab.general'));
      await act(async () => general?.click());
      expect(document.querySelector<HTMLInputElement>('#page-slug')?.value).toBe('my-address');
    });
  });
});
