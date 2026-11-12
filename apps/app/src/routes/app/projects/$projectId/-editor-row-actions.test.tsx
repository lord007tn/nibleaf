// @vitest-environment jsdom
/**
 * AUTH-38: what the page tree's row menu does in the editor: Duplicate opens the
 * copy, Copy link copies the published address, Hide saves the flag against the
 * revision the writer saw, Move to… opens its dialog, and Viewers only get the
 * actions that change nothing.
 */

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
  success: vi.fn(),
  duplicate: vi.fn(),
  neverPublished: false,
  pendingChanges: undefined as { hasBaseline: boolean; changes: Array<Record<string, unknown>> } | undefined,
  tree: {} as Record<string, unknown>,
  moveDialog: vi.fn(),
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
  Link: ({ children, to: _to, params: _params, ...props }: { children: ReactNode; to: string; params: unknown }) => <a {...props}>{children}</a>,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn(), usePrompt: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.toast, success: mocks.success } }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ getQueryData: () => undefined }) }));
vi.mock('@/hooks/api', async () => ({
  useProject: () => ({ data: { id: 'project-1', name: 'Test site', config: {} } }),
  useProjectMembers: () => ({ data: { members: [{ role: mocks.role, user: { id: 'user-1' } }] }, isPending: mocks.membersPending }),
  useAiDraftCapability: () => mocks.capability,
  addressMayFollowTitle: () => false,
  friendlyErrorMessage: (await import('@/hooks/api/errors')).friendlyErrorMessage,
  pageNeverPublished: () => mocks.neverPublished,
  pagePublishState: () => 'unchanged',
  queryKeys: (await import('@/hooks/api/query-keys')).queryKeys,
  useBranches: () => ({}),
  useLanguages: () => ({ data: [{ id: 'lang-en', code: 'en', label: 'English', isDefault: true }] }),
  usePages: () => ({ data: mocks.pages, isPending: false }),
  usePage: () => ({ data: mocks.page }),
  usePendingChanges: () => ({ data: mocks.pendingChanges }),
  useComments: () => ({}),
  useCreatePage: () => ({ mutate: mocks.create, isPending: false }),
  useUpdatePage: () => ({ mutateAsync: mocks.update, mutate: mocks.update }),
  useUploadAsset: () => ({}),
  useDeleteAsset: () => ({}),
  useReorderPages: () => ({}),
  useDuplicatePage: () => ({ mutate: mocks.duplicate, isPending: false }),
  useDomains: () => ({ data: [{ domain: 'docs.example.com' }] }),
  pickLiveDomain: (domains: Array<{ domain: string }>) => domains[0],
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
  SortablePageTree: (props: Record<string, unknown>) => {
    mocks.tree = props;
    return null;
  },
  PageTreeDndProvider: ({ children }: { children: ReactNode }) => children,
  LanguageDropTarget: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/editor/move-page-dialog', () => ({
  MovePageDialog: (props: Record<string, unknown>) => {
    mocks.moveDialog(props);
    return null;
  },
}));
vi.mock('@/components/editor/tiptap-editor', () => ({
  TiptapEditor: ({ onChange }: { onChange: (content: string) => void }) => (
    <textarea aria-label="Test document" onChange={(event) => onChange(event.target.value)} />
  ),
}));

import { Route } from './editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const Editor = Route.options.component as ComponentType;

type TreeProps = {
  onDuplicate?: (id: string) => void;
  onCopyLink?: (id: string) => void;
  onMoveTo?: (id: string) => void;
  onToggleHidden?: (id: string) => void;
  pageHref?: (id: string) => string;
};
const tree = () => mocks.tree as TreeProps;

describe('page tree row actions in the editor (AUTH-38)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const open = {
    id: 'page-1',
    kind: 'PAGE',
    title: 'Guide',
    slug: 'guide',
    path: 'guide',
    content: 'Body',
    languageId: 'lang-en',
    parentId: null,
    position: 0,
    hidden: false,
    updatedAt: '2026-11-10T08:00:00.000Z',
  };
  const other = {
    ...open,
    id: 'page-2',
    title: 'Install',
    slug: 'install',
    path: 'guides/install',
    position: 1,
    updatedAt: '2026-11-10T09:00:00.000Z',
  };

  async function render(role = 'member') {
    mocks.role = role;
    await act(async () => root.render(<Editor />));
  }

  beforeEach(() => {
    mocks.page = open;
    mocks.pages = [open, other];
    mocks.neverPublished = false;
    mocks.pendingChanges = undefined;
    for (const mock of [mocks.update, mocks.duplicate, mocks.toast, mocks.success, mocks.moveDialog]) mock.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('hides a page through the page update, conditional on the revision the writer saw', async () => {
    await render();
    await act(async () => tree().onToggleHidden?.('page-2'));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
      { pageId: 'page-2', body: { hidden: true, expectedUpdatedAt: '2026-11-10T09:00:00.000Z' } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    const [, callbacks] = mocks.update.mock.calls[0] as [unknown, { onSuccess: () => void; onError: (error: unknown) => void }];
    await act(async () => callbacks.onSuccess());
    expect(mocks.success).toHaveBeenCalledWith('editor.hiddenNotice');
    await act(async () => callbacks.onError(new Error('offline')));
    expect(mocks.toast).toHaveBeenCalledWith('editor.visibilityFailed');
  });

  it('shows a hidden page again without a notice', async () => {
    mocks.pages = [open, { ...other, hidden: true }];
    await render();
    await act(async () => tree().onToggleHidden?.('page-2'));
    const [request, callbacks] = mocks.update.mock.calls[0] as [{ body: { hidden: boolean } }, { onSuccess: () => void }];
    expect(request.body.hidden).toBe(false);
    await act(async () => callbacks.onSuccess());
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('duplicates, then opens the copy', async () => {
    await render();
    mocks.duplicate.mockImplementation((_id: string, callbacks: { onSuccess: (page: unknown) => void; onSettled: () => void }) => {
      callbacks.onSuccess({ ...other, id: 'page-3', title: 'Install (copy)' });
      callbacks.onSettled();
    });
    await act(async () => tree().onDuplicate?.('page-2'));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.duplicate).toHaveBeenCalledWith('page-2', expect.anything());
    expect(mocks.success).toHaveBeenCalledWith('editor.duplicated');
  });

  it('opens the copy ready to rename: keys typed while it is created go into its title', async () => {
    await render();
    let created!: () => void;
    const copy = { ...other, id: 'page-3', title: 'Install (copy)', slug: 'install-2', path: 'guides/install-2' };
    mocks.duplicate.mockImplementation((_id: string, callbacks: { onSuccess: (page: unknown) => void; onSettled: () => void }) => {
      created = () => {
        mocks.page = copy;
        mocks.pages = [open, other, copy];
        callbacks.onSuccess(copy);
        callbacks.onSettled();
      };
    });
    await act(async () => tree().onDuplicate?.('page-2'));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.duplicate).toHaveBeenCalledOnce();
    for (const key of ['S', 'e', 't', 'u', 'p']) {
      await act(async () => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
    }
    await act(async () => created());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const title = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="editor.pageTitlePlaceholder"]');
    expect(document.activeElement).toBe(title);
    expect(title?.value).toBe('Setup');
  });

  it.each([
    [false, 'editor.linkCopied'],
    [true, 'editor.linkCopiedUnpublished'],
  ])('copies the published address (never published: %s)', async (neverPublished, message) => {
    mocks.neverPublished = neverPublished;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await render();
    await act(async () => tree().onCopyLink?.('page-2'));
    expect(writeText).toHaveBeenCalledWith('https://docs.example.com/guides/install');
    expect(mocks.success).toHaveBeenCalledWith(message);
  });

  it('copies the live address of a published page whose draft moved it, until the next publish', async () => {
    // Published at guides/install; the draft has since moved it to guides/setup.
    mocks.pages = [open, { ...other, slug: 'setup', path: 'guides/setup' }];
    mocks.pendingChanges = {
      hasBaseline: true,
      changes: [
        { id: 'page-2', status: 'modified', path: 'guides/setup', languageCode: 'en', published: { path: 'guides/install', languageCode: 'en' } },
      ],
    };
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await render();
    await act(async () => tree().onCopyLink?.('page-2'));
    expect(writeText).toHaveBeenCalledWith('https://docs.example.com/guides/install');
    expect(mocks.success).toHaveBeenCalledWith('editor.linkCopied');
  });

  it("says a hidden page's link won't open on the published site", async () => {
    mocks.neverPublished = false;
    mocks.pages = [open, { ...other, hidden: true }];
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await render();
    await act(async () => tree().onCopyLink?.('page-2'));
    expect(writeText).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith('editor.linkCopiedHidden');
  });

  it('copies nothing for a group, which has no address of its own', async () => {
    mocks.pages = [open, { ...other, kind: 'GROUP' }];
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await render();
    await act(async () => tree().onCopyLink?.('page-2'));
    expect(writeText).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('links each row to its page in the editor, for a new tab', async () => {
    await render();
    expect(tree().pageHref?.('page-2')).toBe('/app/projects/project-1/editor?page=page-2');
  });

  it('opens Move to… for the chosen page', async () => {
    await render();
    await act(async () => tree().onMoveTo?.('page-2'));
    expect(mocks.moveDialog).toHaveBeenLastCalledWith(expect.objectContaining({ page: expect.objectContaining({ id: 'page-2' }) }));
  });

  it('gives a Viewer Copy link and Open in new tab, and never the Move dialog', async () => {
    await render('viewer');
    expect(tree().onCopyLink).toEqual(expect.any(Function));
    expect(tree().pageHref).toEqual(expect.any(Function));
    await act(async () => tree().onMoveTo?.('page-2'));
    expect(mocks.moveDialog).not.toHaveBeenCalled();
  });
});
