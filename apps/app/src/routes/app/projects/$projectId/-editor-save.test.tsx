// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  role: 'member',
  membersPending: false,
  sessionPending: false,
  locale: 'en',
  navigate: vi.fn(),
  prefetch: vi.fn(),
  schedule: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  toast: vi.fn(),
  pages: [] as Array<Record<string, unknown>>,
  page: undefined as Record<string, unknown> | undefined,
  capability: { isPending: false, data: undefined } as {
    isPending: boolean;
    isError?: boolean;
    data?: { available: boolean; reason: string | null };
  },
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: mocks.locale }) }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ projectId: 'project-1' }),
    useSearch: () => ({}),
    useNavigate: () => mocks.navigate,
  }),
  useBlocker: () => undefined,
  useRouter: () => ({ buildLocation: () => ({ href: '' }) }),
  Link: ({ children, to: _to, params: _params, ...props }: { children: ReactNode; to: string; params: unknown }) => <a {...props}>{children}</a>,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn(), usePrompt: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ getQueryData: () => undefined }) }));
vi.mock('@/hooks/api', async () => ({
  useProject: () => ({ data: { id: 'project-1', name: 'Test site', config: {} } }),
  useProjectMembers: () => ({ data: { members: [{ role: mocks.role, user: { id: 'user-1' } }] }, isPending: mocks.membersPending }),
  useAiDraftCapability: () => mocks.capability,
  addressMayFollowTitle: () => false,
  friendlyErrorMessage: (await import('@/hooks/api/errors')).friendlyErrorMessage,
  pageNeverPublished: () => false,
  pagePublishState: () => 'unchanged',
  queryKeys: (await import('@/hooks/api/query-keys')).queryKeys,
  useBranches: () => ({}),
  useOpenApiConfiguration: () => ({}),
  useLanguages: () => ({ data: [{ id: 'lang-en', code: 'en', label: 'English', isDefault: true }] }),
  usePages: () => ({ data: mocks.pages, isPending: false }),
  usePage: () => ({ data: mocks.page }),
  usePendingChanges: () => ({}),
  useComments: () => ({}),
  useCreatePage: () => ({ mutate: mocks.create, isPending: false }),
  useUpdatePage: () => ({ mutateAsync: mocks.update }),
  useUploadAsset: () => ({}),
  useDeleteAsset: () => ({}),
  useReorderPages: () => ({}),
  useDuplicatePage: () => ({ mutate: vi.fn(), isPending: false }),
  useDomains: () => ({}),
  pickLiveDomain: () => undefined,
}));
vi.mock('@/hooks/api/query-options', () => ({
  aiDraftCapabilityQueryOptions: (id: string) => ({ queryKey: ['workspace-ai', id, 'draft-capability'] }),
  commentsQueryOptions: vi.fn(),
  pageQueryOptions: vi.fn(),
  projectMembersQueryOptions: (id: string) => ({ queryKey: ['members', id] }),
}));
vi.mock('@/hooks/api/route-prefetch', () => ({ prefetchScopedPages: vi.fn() }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: mocks.prefetch }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } }, isPending: mocks.sessionPending }) }));
vi.mock('@/layouts/project', () => ({ PublishControl: () => null }));
vi.mock('@/components/editor/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('@/components/editor/use-delete-page', () => ({ useDeletePageFlow: () => vi.fn() }));
vi.mock('@/components/editor/page-trash-button', () => ({ PageTrashButton: () => null }));
vi.mock('@/components/editor/use-ai-assist-session', () => ({ useAiAssistSession: () => ({}), aiAssistPageId: () => null }));
vi.mock('@/components/editor/site-config-panel', () => ({
  ConfigSectionList: () => <nav data-testid="config-sections" />,
  ConfigSection: () => (
    <form aria-label="Site settings">
      <input aria-label="Site name" />
    </form>
  ),
}));
vi.mock('@/components/project-settings/shared', () => ({ ConfigDirtyProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/editor/add-language-dialog', () => ({ AddLanguageDialog: () => null }));
vi.mock('@/components/editor/ai-assist', () => ({ AiAssist: () => null }));
vi.mock('@/components/editor/branch-switcher', () => ({ BranchSwitcher: () => null }));
vi.mock('@/components/editor/comments-panel', () => ({ CommentsPanel: () => null }));
vi.mock('@/components/editor/language-settings-dialog', () => ({ LanguageSettingsDialog: () => null }));
vi.mock('@/components/editor/markdown-source-editor', () => ({ MarkdownSourceEditor: () => null }));
vi.mock('@/components/editor/page-settings-dialog', () => ({ PageSettingsDialog: () => null }));
vi.mock('@/components/editor/sortable-page-tree', () => ({
  SortablePageTree: () => null,
  PageTreeDndProvider: ({ children }: { children: ReactNode }) => children,
  LanguageDropTarget: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/editor/tiptap-editor', () => ({
  TiptapEditor: ({ onChange }: { onChange: (content: string) => void }) => (
    <textarea aria-label="Test document" onChange={(event) => onChange(event.target.value)} />
  ),
}));

import { ApiResponseError } from '@/hooks/api/client-helpers';
import { Route } from './editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const Editor = Route.options.component as ComponentType;

describe('AUTH-16 editor save lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  const page = {
    id: 'page-1',
    kind: 'PAGE',
    title: 'Guide',
    slug: 'guide',
    path: '/guide',
    content: 'Body',
    languageId: 'lang-en',
    parentId: null,
    position: 0,
    updatedAt: 'revision-1',
  };
  beforeEach(async () => {
    mocks.page = page;
    mocks.pages = [page];
    mocks.role = 'member';
    mocks.update.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
    await act(async () => root.render(<Editor />));
  });
  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  async function edit(value: string) {
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Test document"]');
    if (!input) throw new Error('Missing editor input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function debounce() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
  }
  it('closes the page drawer after creating a page from it, so the focused title is visible', async () => {
    const showPages = container.querySelector<HTMLButtonElement>('button[aria-label="editor.showPages"]');
    if (!showPages) throw new Error('Missing the page drawer button');
    await act(async () => showPages.click());
    // The drawer button says whether the page drawer is open.
    const drawerOpen = () => showPages.getAttribute('aria-expanded');
    expect(drawerOpen()).toBe('true');
    const created = { ...page, id: 'page-new', title: '', slug: 'untitled', path: 'untitled' };
    mocks.create.mockImplementation((_body, callbacks) => {
      mocks.page = created;
      mocks.pages = [page, created];
      callbacks.onSuccess(created);
      callbacks.onSettled();
    });
    const newPage = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('editor.newPage'));
    if (!newPage) throw new Error('Missing new page action');
    await act(async () => newPage.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(drawerOpen()).toBe('false');
    const title = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="editor.pageTitlePlaceholder"]');
    expect(document.activeElement).toBe(title);
  });
  it('AUTH-07: failed creation clears the pending canvas and restores the action focus', async () => {
    mocks.page = undefined;
    mocks.pages = [];
    await act(async () => root.render(<Editor />));
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('editor.newPage'));
    if (!button) throw new Error('Missing new page action');
    let failure!: () => void;
    mocks.create.mockImplementation((_body, callbacks) => {
      failure = () => {
        callbacks.onError(new Error('failed'));
        callbacks.onSettled();
      };
    });
    button.focus();
    await act(async () => button.click());
    expect(container.textContent).toContain('editor.creatingPage');
    await act(async () => failure());
    expect(container.textContent).not.toContain('editor.creatingPage');
    expect(container.textContent).toContain('editor.noPageSelected');
    expect(document.activeElement?.textContent).toContain('editor.newPage');
    expect(mocks.pages).toEqual([]);
  });
  it.each(['error', 'offline', 'conflict'])('settles %s with a retry or conflict-review action', async (kind) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(kind !== 'offline');
    mocks.update.mockRejectedValue(
      kind === 'conflict' ? Object.assign(new Error('conflict'), { status: 409, code: 'page:revision_conflict' }) : new TypeError('Failed to fetch'),
    );
    await edit('Unsaved');
    await debounce();
    expect(container.textContent).not.toContain('editor.savingShort');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      kind === 'offline' ? 'site.aiOffline' : kind === 'conflict' ? 'editor.conflict.body' : 'editor.saveError',
    );
    expect(container.querySelector('[role="alert"] button')?.textContent).toBe(kind === 'conflict' ? 'editor.conflict.review' : 'editor.retrySave');
  });
  it('keeps a draft the server refused as too large, says why, and waits for the next edit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tooLarge = new ApiResponseError(
      'This page is too large (2 MB maximum). Split it into smaller pages.',
      413,
      'page:too_large',
      undefined,
      undefined,
      undefined,
      undefined,
      { bytes: 2_097_153, limit: 2_097_152 },
    );
    mocks.update.mockRejectedValue(tooLarge);
    await edit('Huge');
    await debounce();
    expect(mocks.update).toHaveBeenCalledOnce();
    // Settled, with the size message and Retry: never left "saving".
    expect(container.textContent).not.toContain('editor.savingShort');
    expect(container.textContent).toContain('editor.saveFailedShort');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('editor.pageTooLarge');
    expect(container.querySelector('[role="alert"] button')?.textContent).toBe('editor.retrySave');
    // The draft stays in the editor.
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Test document"]')?.value).toBe('Huge');

    // A page refetch re-runs autosave; the refused text is not sent again.
    mocks.page = { ...page };
    await act(async () => root.render(<Editor />));
    await debounce();
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('editor.savingShort');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('editor.pageTooLarge');

    // The next edit is saved.
    mocks.update.mockResolvedValue({ ...page, content: 'Smaller', updatedAt: 'revision-2' });
    await edit('Smaller');
    await debounce();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ content: 'Smaller' }) }));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('editor.savedShort');

    // The refusal was measured at revision-1. The baseline is now revision-2,
    // where the same text may fit (here the server accepts it): it is sent.
    mocks.update.mockResolvedValue({ ...page, content: 'Huge', updatedAt: 'revision-3' });
    await edit('Huge');
    await debounce();
    expect(mocks.update).toHaveBeenCalledTimes(3);
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ content: 'Huge', expectedUpdatedAt: 'revision-2' }) }),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('editor.savedShort');
  });
  it('settles a cancelled debounced draft when undo restores the server copy', async () => {
    await edit('Unsaved');
    expect(container.textContent).toContain('editor.savingShort');
    await edit('Body');
    await debounce();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('editor.savingShort');
  });
  it('unmounts mid-save and reopens without a stuck status or React warnings', async () => {
    let resolve!: (value: unknown) => void;
    mocks.update.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const errors = vi.spyOn(console, 'error');
    await edit('Unsaved');
    await debounce();
    expect(mocks.update).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    mounted = false;
    await act(async () => resolve({ ...page, content: 'Unsaved', updatedAt: 'revision-2' }));
    root = createRoot(container);
    mounted = true;
    await act(async () => root.render(<Editor />));
    expect(container.textContent).not.toContain('editor.savingShort');
    expect(errors).not.toHaveBeenCalled();
  });
});
