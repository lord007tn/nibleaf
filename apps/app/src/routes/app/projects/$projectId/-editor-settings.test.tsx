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
vi.mock('@/components/editor/editor-save-throttle', () => ({
  useSaveThrottle: () => ({ maybeExecute: mocks.schedule, cancel: vi.fn(), flush: vi.fn() }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useQueries: ({ combine }: { combine: (results: unknown[]) => unknown }) => combine([]),
}));
vi.mock('@/components/editor/linked-page-history', () => ({ useLinkedPageHistory: () => vi.fn() }));
vi.mock('@/hooks/api', () => ({
  useProject: () => ({ data: { id: 'project-1', name: 'Test site', config: {} } }),
  useProjectMembers: () => ({ data: { members: [{ role: mocks.role, user: { id: 'user-1' } }] }, isPending: mocks.membersPending }),
  useAiDraftCapability: () => mocks.capability,
  addressMayFollowTitle: () => false,
  friendlyErrorMessage: () => '',
  pageNeverPublished: () => false,
  pagePublishState: () => 'unchanged',
  queryKeys: { pages: { allForProject: (id: string) => ['pages', id] } },
  useBranches: () => ({}),
  useOpenApiConfiguration: () => ({}),
  useLanguages: () => ({}),
  usePages: () => ({ data: mocks.pages, isPending: false }),
  usePage: () => ({ data: mocks.page }),
  usePendingChanges: () => ({}),
  useComments: () => ({}),
  useCreatePage: () => ({}),
  useUpdatePage: () => ({}),
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
  pagesQueryOptions: vi.fn(),
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
  ConfigSectionList: ({ onSelect }: { onSelect: (section: string) => void }) => (
    <nav data-testid="config-sections">
      <button type="button" onClick={() => onSelect('seo')}>
        section-seo
      </button>
    </nav>
  ),
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
vi.mock('@/components/editor/save-status', () => ({ NeverPublishedBanner: () => null, PagePublishStateBar: () => null, SaveStatus: () => null }));

import { Route } from './editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const Editor = Route.options.component as ComponentType;

describe('editor site settings permissions', () => {
  let container: HTMLDivElement;
  let root: Root;
  const settingsButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="editor.mode.configuration"]');
  const render = () => act(async () => root.render(<Editor />));
  const openSettings = () => act(async () => settingsButton()?.click());

  beforeEach(() => {
    mocks.role = 'member';
    mocks.membersPending = false;
    mocks.sessionPending = false;
    mocks.locale = 'en';
    mocks.pages = [];
    mocks.page = undefined;
    mocks.capability = { isPending: false, data: undefined };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each(['member', 'viewer', ''])('hides the Settings button for role %s', async (role) => {
    mocks.role = role;
    await render();
    expect(settingsButton()).toBeNull();
    expect(container.querySelector('[data-testid="config-sections"]')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });

  it.each(['admin', 'owner'])('keeps the Settings button, navigation and forms for %s', async (role) => {
    mocks.role = role;
    await render();
    expect(settingsButton()).not.toBeNull();
    await openSettings();
    expect(container.querySelector('[data-testid="config-sections"]')).not.toBeNull();
    expect(container.querySelector('form input[aria-label="Site name"]')).not.toBeNull();
  });

  it('keeps the settings sections reachable on a phone after one is chosen', async () => {
    mocks.role = 'admin';
    await render();
    await openSettings();
    const drawer = () => container.querySelector<HTMLButtonElement>('button[aria-label="editor.showSidebar"][aria-expanded]');
    // Opening Site settings shows the section list.
    expect(drawer()?.getAttribute('aria-expanded')).toBe('true');
    const section = [...container.querySelectorAll('button')].find((button) => button.textContent === 'section-seo');
    await act(async () => section?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    // Choosing a section closes the drawer; the header button opens it again.
    expect(drawer()?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => drawer()?.click());
    expect(drawer()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('replaces stale configuration with an announced note and a way back to writing, including in RTL', async () => {
    mocks.role = 'admin';
    await render();
    await openSettings();
    mocks.role = 'member';
    mocks.locale = 'ar';
    await render();
    expect(settingsButton()).toBeNull();
    expect(container.querySelector('[data-testid="config-sections"]')).toBeNull();
    expect(container.querySelector('main [role="status"]')?.textContent).toBe('editor.config.adminOnly');
    expect(container.querySelector('main form, main input, main textarea, main select')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const back = [...container.querySelectorAll('button')].find((button) => button.textContent === 'editor.config.backToWriting');
    expect(back).toBeDefined();
    back?.focus();
    expect(document.activeElement).toBe(back);
    await act(async () => back?.click());
    expect(document.activeElement).toBe(container.querySelector('main'));
    expect(container.textContent).not.toContain('editor.config.adminOnly');
    expect(container.textContent).toContain('editor.noPageSelected');
  });

  it.each(['members', 'session'])('hides Settings until %s finishes loading, even with cached admin data', async (source) => {
    mocks.role = 'admin';
    mocks.membersPending = source === 'members';
    mocks.sessionPending = source === 'session';
    await render();
    expect(settingsButton()).toBeNull();
    mocks.role = 'member';
    mocks.membersPending = false;
    mocks.sessionPending = false;
    await render();
    expect(settingsButton()).toBeNull();
    mocks.role = 'admin';
    await render();
    expect(settingsButton()).not.toBeNull();
  });

  it('never mounts forms while permissions are loading in an already open panel', async () => {
    mocks.role = 'admin';
    await render();
    await openSettings();
    mocks.membersPending = true;
    await render();
    expect(settingsButton()).toBeNull();
    expect(container.querySelector('main form')).toBeNull();
    expect(container.querySelector('main [aria-busy="true"]')).not.toBeNull();
  });

  it('does not accept section-style configuration deep links', () => {
    const validateSearch = Route.options.validateSearch as (search: Record<string, unknown>) => unknown;
    expect(validateSearch({ section: 'branding', view: 'config' })).toEqual({});
  });

  it('prefetches membership with the existing query factory', () => {
    const loader = Route.options.loader as (args: unknown) => void;
    loader({ context: { queryClient: {} }, params: { projectId: 'project-1' }, deps: {} });
    expect(mocks.prefetch).toHaveBeenCalledWith({}, { queryKey: ['members', 'project-1'] });
  });

  it("prefetches the site's AI drafting capability instead of the instance-wide flag", () => {
    const loader = Route.options.loader as (args: unknown) => void;
    loader({ context: { queryClient: {} }, params: { projectId: 'project-1' }, deps: {} });
    expect(mocks.prefetch).toHaveBeenCalledWith({}, { queryKey: ['workspace-ai', 'project-1', 'draft-capability'] });
  });

  it('never requests Trash when the editor opens', () => {
    const loader = Route.options.loader as (args: unknown) => void;
    loader({ context: { queryClient: {} }, params: { projectId: 'project-1' }, deps: {} });
    const keys = mocks.prefetch.mock.calls.map(([, options]) => (options as { queryKey?: unknown[] } | undefined)?.queryKey?.[0]);
    expect(keys).not.toContain('page-trash');
  });
});

describe('editor AI assist availability', () => {
  let container: HTMLDivElement;
  let root: Root;
  const page = { id: 'page-1', kind: 'PAGE', title: 'Guide', slug: 'guide', content: 'Body', languageId: 'lang-en', parentId: null, order: 0 };
  const render = () => act(async () => root.render(<Editor />));
  const aiTab = () => [...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === 'editor.ai');
  const railToggle = () => container.querySelector<HTMLButtonElement>('button[title="editor.hideRail"], button[title="editor.hideComments"]');

  it('council: autosave carries the editor base revision while a remote rename refresh arrives', async () => {
    mocks.page = { ...page, updatedAt: '2026-11-01T00:00:00.000Z' };
    await render();
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Test document"]');
    if (!input) throw new Error('Editor document was not rendered');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, '[link](/old)\nUnsaved text');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    mocks.page = { ...page, content: '[link](/new)', updatedAt: '2026-11-02T00:00:00.000Z' };
    await render();
    expect(mocks.schedule).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: '[link](/old)\nUnsaved text', expectedUpdatedAt: '2026-11-01T00:00:00.000Z' }),
    );
  });

  beforeEach(() => {
    mocks.role = 'member';
    mocks.membersPending = false;
    mocks.sessionPending = false;
    mocks.locale = 'en';
    mocks.pages = [page];
    mocks.page = page;
    window.localStorage.setItem('nibleaf.editor.railOpen', '1');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
  });

  it('shows AI assist when only the workspace connection can draft (no instance key)', async () => {
    mocks.capability = { isPending: false, data: { available: true, reason: null } };
    await render();
    expect(aiTab()).toBeDefined();
    expect(container.querySelector('[data-testid="ai-tab-placeholder"]')).toBeNull();
    expect(railToggle()?.title).toBe('editor.hideRail');
  });

  it.each(['site_disabled', 'instance_disabled', 'quota', 'quota_unavailable'])(
    'keeps AI assist reachable for %s so the panel can explain it',
    async (reason) => {
      mocks.capability = { isPending: false, data: { available: false, reason } };
      await render();
      expect(aiTab()).toBeDefined();
    },
  );

  it('hides AI assist only when the site has no way to draft', async () => {
    mocks.capability = { isPending: false, data: { available: false, reason: 'not_configured' } };
    await render();
    expect(aiTab()).toBeUndefined();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(railToggle()?.title).toBe('editor.hideComments');
  });

  it('keeps AI assist reachable when the capability request fails, since unknown is not "no"', async () => {
    mocks.capability = { isPending: false, isError: true, data: undefined };
    await render();
    expect(aiTab()).toBeDefined();
  });

  it('holds the AI tab place while the capability loads, without offering or removing it', async () => {
    mocks.capability = { isPending: true, data: undefined };
    await render();
    expect(aiTab()).toBeUndefined();
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[data-testid="ai-tab-placeholder"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(railToggle()?.title).toBe('editor.hideRail');
    mocks.capability = { isPending: false, data: { available: true, reason: null } };
    await render();
    expect(aiTab()).toBeDefined();
    expect(container.querySelector('[data-testid="ai-tab-placeholder"]')).toBeNull();
  });
});
