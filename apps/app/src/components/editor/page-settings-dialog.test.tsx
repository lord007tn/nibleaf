/** @vitest-environment jsdom */
import { pageDescription } from '@nibleaf/shared/markdown-text';
import { truncateText } from '@nibleaf/shared/utils';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api/types';
import { PageSettingsDialog } from './page-settings-dialog';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => mocks.translate }));
const mocks = vi.hoisted(() => ({
  reorder: vi.fn(),
  confirm: vi.fn(),
  /** The page update request; each test decides when (and how) it settles. */
  update: vi.fn(),
  success: vi.fn(),
  translate: vi.fn((key: string) => key),
  searchDescription: vi.fn((): { data?: { description: string; revision: string }; isPending: boolean; isFetching: boolean; isError: boolean } => ({
    isPending: true,
    isFetching: true,
    isError: false,
  })),
}));
type UpdateResult = { addressChanged: boolean; redirectsAdded: number; linksUpdated: number; documentsSkipped: number };
const saved: UpdateResult = { addressChanged: false, redirectsAdded: 0, linksUpdated: 0, documentsSkipped: 0 };
/** A promise the test settles by hand, to act while a request is in flight. */
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: vi.fn() } }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: () => 'error',
  useUpdatePage: () => ({
    isPending: false,
    mutateAsync: (variables: unknown) => mocks.update(variables),
    mutate: (variables: unknown, options?: { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void }) =>
      void Promise.resolve(mocks.update(variables)).then(options?.onSuccess, options?.onError),
  }),
  useReorderPages: () => ({ isPending: false, mutate: mocks.reorder }),
  usePageSearchDescription: (...args: unknown[]) => mocks.searchDescription(...(args as [])),
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
    mocks.update.mockReset().mockResolvedValue(saved);
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
    const saving = deferred<UpdateResult>();
    mocks.update.mockReturnValueOnce(saving.promise);
    const save = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('editor.pageSettings.save'));
    if (!save) throw new Error('Save button was not rendered');
    await act(async () => save.click());
    await act(async () => saving.resolve({ ...result, documentsSkipped: 0 }));
    expect(mocks.success).toHaveBeenLastCalledWith(message);
    if (result.addressChanged) expect(mocks.translate).toHaveBeenCalledWith(message, { path: '\u2066/original\u2069', redirects: 1, links: 2 });
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

  describe('the generated search description', () => {
    /** What the server answers: the description generated from the saved content, for the page's current revision. */
    const serve = (content: string, { revision = page.updatedAt, isFetching = false } = {}) => {
      const generated = pageDescription({ ...page, content });
      mocks.searchDescription.mockReturnValue({ data: { description: generated, revision }, isPending: false, isFetching, isError: false });
      return generated;
    };
    const openSeo = async (nextPage: PageNode = page, onOpenChange = vi.fn()) => {
      await act(async () => root.render(<PageSettingsDialog onOpenChange={onOpenChange} open page={nextPage} projectId="project-a" />));
      const tab = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('editor.pageSettings.tab.seo'));
      await act(async () => tab?.click());
    };
    /** Short words, so the generated text ends past the 155 characters a search result shows. */
    const LONG_CONTENT = `Nibleaf ${'docs go up in a day so you can '.repeat(8)}`;
    const preview = () => document.querySelector('[data-testid="search-description-preview"]');
    const previewText = () => document.querySelector('[data-slot="search-description"]');
    const writeOwn = () =>
      [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('editor.pageSettings.searchPreview.writeOwn'));
    const saveButton = () => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('editor.pageSettings.save'));
    const metaField = () => document.querySelector<HTMLTextAreaElement>('#page-meta-desc');

    afterEach(() => mocks.searchDescription.mockReset());

    it('shows what search engines will see when the page has no description', async () => {
      const generated = serve('# Install\n\nInstall the CLI and sign in to publish your first site.');
      await openSeo();
      expect(mocks.searchDescription).toHaveBeenLastCalledWith('project-a', 'page-a', { enabled: true });
      expect(preview()?.textContent).toContain('editor.pageSettings.searchPreview.label');
      expect(preview()?.textContent).toContain('editor.pageSettings.searchPreview.prompt');
      expect(previewText()?.textContent).toBe(generated);
    });

    it('cuts a long description where search results cut it', async () => {
      const generated = serve(LONG_CONTENT);
      await openSeo();
      expect(truncateText(generated, 155)).not.toBe(generated);
      expect(previewText()?.textContent).toBe(truncateText(generated, 155));
    });

    it('"Write your own" fills the field with the generated text and focuses it', async () => {
      const generated = serve(LONG_CONTENT);
      await openSeo();
      await act(async () => writeOwn()?.click());
      const field = document.querySelector<HTMLTextAreaElement>('#page-meta-desc');
      // The full generated text, not the shortened preview, so nothing is lost while editing.
      expect(field?.value).toBe(generated);
      expect(document.activeElement).toBe(field);
      // The author's text is now the description: the prompt is gone.
      expect(preview()).toBeNull();
    });

    it.each([
      ['an SEO description', { ...page, config: { seo: { metaDescription: 'Install the CLI in a minute.' } } }],
      ['a page summary', { ...page, description: 'Install the CLI in a minute.' }],
    ] satisfies Array<[string, PageNode]>)('shows no prompt when the page has %s', async (_case, described) => {
      serve('Install the CLI and sign in.');
      await openSeo(described);
      expect(preview()).toBeNull();
      expect(writeOwn()).toBeUndefined();
      expect(mocks.searchDescription).toHaveBeenLastCalledWith('project-a', 'page-a', { enabled: false });
    });

    it('never shows or adopts an answer computed from an older saved body', async () => {
      // Cached from before the last save: the page is now at a later revision and the refetch is still running.
      serve('The body as it was before the last save.', { revision: '2026-10-14T23:00:00Z', isFetching: true });
      await openSeo();
      expect(previewText()).toBeNull();
      expect(document.querySelector('[data-slot="search-description-loading"]')).not.toBeNull();
      expect(writeOwn()?.disabled).toBe(true);
      await act(async () => writeOwn()?.click());
      expect(metaField()?.value).toBe('');
    });

    it('keeps a description adopted during a save, and stays open with it unsaved', async () => {
      const generated = serve('Install the CLI and sign in to publish your first site.');
      const close = vi.fn();
      await openSeo(page, close);
      const saving = deferred<UpdateResult>();
      mocks.update.mockReturnValueOnce(saving.promise);
      await act(async () => saveButton()?.click());
      // While the first save is in flight, the author adopts the generated text.
      await act(async () => writeOwn()?.click());
      expect(metaField()?.value).toBe(generated);
      await act(async () => saving.resolve(saved));
      expect(mocks.success).toHaveBeenLastCalledWith('editor.pageSettings.saved');
      // That save didn't carry the adopted text, so the dialog stays open with it.
      expect(close).not.toHaveBeenCalledWith(false);
      expect(metaField()?.value).toBe(generated);
      // Saving again sends it, and then the dialog closes.
      await act(async () => saveButton()?.click());
      expect(mocks.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ config: expect.objectContaining({ seo: expect.objectContaining({ metaDescription: generated }) }) }),
        }),
      );
      expect(close).toHaveBeenLastCalledWith(false);
    });

    it('lets Arabic text take its own direction', async () => {
      const generated = serve('## البداية\n\nثبّت أداة سطر الأوامر وسجّل الدخول لنشر موقعك الأول.');
      await openSeo();
      expect(generated).toContain('ثبّت');
      expect(previewText()?.textContent).toBe(generated);
      expect(previewText()?.getAttribute('dir')).toBe('auto');
    });
  });
});
