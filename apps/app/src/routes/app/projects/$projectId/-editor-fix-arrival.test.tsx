// @vitest-environment jsdom
/**
 * P1-ED-002, end to end in the editor route: a publish check's Fix
 * (`?page=<id>&fix=<code>&fixTarget=<evidence>`) opens the page AT the problem.
 * The real route, the real TipTap editor, a mocked API and fake timers.
 *
 * - Each check found by its evidence: the first place is selected, marked and
 *   scrolled to; the bar says "1 of N"; Next moves on; the Fix is dropped from
 *   the address with a replace; nothing is saved.
 * - Evidence no longer on the page: the bar says so, without an error.
 * - Page-level checks focus their field: the title, the body, the address.
 * - Links into the site that lead to no page are flagged while writing, as
 *   decorations only (never in the saved Markdown).
 */

import type { PublishCheckCode } from '@nibleaf/shared/publish-check-codes';
// The publish checks' own reading of a page (server-side; here only as the oracle for the count).
import { type PageContentFacts, pageContentFacts } from '@nibleaf/shared/publish-checks';
import type { Editor as TiptapCore } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMarkdown } from '@/components/editor/tiptap-editor';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  update: vi.fn(),
  search: {} as Record<string, unknown>,
  page: undefined as Record<string, unknown> | undefined,
  pages: [] as Array<Record<string, unknown>>,
  settings: null as null | { initialField?: string; page: { id: string } },
  // Stable across renders, as in the app: a resolver rebuilt on every render would hide a stale flag.
  queryClient: { getQueryData: () => undefined },
  noVersions: { pages: [], complete: true },
  linked: { open: () => Promise.resolve(), href: () => '' },
  resolvers: 0,
}));
// Messages with their variables, so "1 of 2" can be read back.
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, unknown>) => (variables ? `${key} ${JSON.stringify(variables)}` : key),
  useLocale: () => ({ locale: 'en', t: (key: string) => key }),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ projectId: 'project-1' }),
    useSearch: () => mocks.search,
    useNavigate: () => mocks.navigate,
  }),
  // The link field's page picker reads the project from the route.
  useParams: () => ({ projectId: 'project-1' }),
  useBlocker: () => undefined,
  useRouter: () => ({ buildLocation: () => ({ href: '' }) }),
  Link: ({ children, to: _to, params: _params, ...props }: { children: ReactNode; to: string; params: unknown }) => <a {...props}>{children}</a>,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn(), usePrompt: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mocks.queryClient,
  useQueries: () => mocks.noVersions,
}));
vi.mock('@/components/editor/linked-page-history', () => ({ useLinkedPageHistory: () => mocks.linked }));
// The real link resolution, counting how often the route builds a resolver.
vi.mock('@/components/editor/editor-links', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/components/editor/editor-links')>();
  return {
    ...real,
    editorLinkResolver: (...args: Parameters<typeof real.editorLinkResolver>) => {
      mocks.resolvers += 1;
      return real.editorLinkResolver(...args);
    },
  };
});
const PROJECT = { id: 'project-1', name: 'Test site', slug: 'test-site', description: null, icon: null, config: {} };
const BRANCHES = [{ id: 'main', name: 'main', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' }];
const ENGLISH = { id: 'lang-en', code: 'en', label: 'English', isDefault: true, direction: 'LTR', position: 0, config: null };
const LANGUAGES = [ENGLISH];
vi.mock('@/hooks/api', async () => ({
  useProject: () => ({ data: PROJECT }),
  useProjectMembers: () => ({ data: { members: [{ role: 'member', user: { id: 'user-1' } }] }, isPending: false }),
  useAiDraftCapability: () => ({ isPending: false, data: undefined }),
  addressMayFollowTitle: () => false,
  friendlyErrorMessage: (await import('@/hooks/api/errors')).friendlyErrorMessage,
  pageNeverPublished: () => false,
  pagePublishState: () => 'unchanged',
  queryKeys: (await import('@/hooks/api/query-keys')).queryKeys,
  // The page's version is known, so links resolve against the site as the publish checks do.
  useBranches: () => ({ data: BRANCHES }),
  useOpenApiConfiguration: () => ({}),
  useLanguages: () => ({ data: LANGUAGES }),
  usePages: () => ({ data: mocks.pages, isPending: false }),
  usePage: () => ({ data: mocks.page, refetch: async () => ({ data: mocks.page }) }),
  usePendingChanges: () => ({}),
  useComments: () => ({}),
  useCreatePage: () => ({ mutate: vi.fn(), isPending: false }),
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
  pagesQueryOptions: vi.fn(),
  pageQueryOptions: vi.fn(),
  projectMembersQueryOptions: (id: string) => ({ queryKey: ['members', id] }),
}));
vi.mock('@/hooks/api/route-prefetch', () => ({ prefetchScopedPages: vi.fn() }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }) }));
vi.mock('@/layouts/project', () => ({ PublishControl: () => null }));
vi.mock('@/components/editor/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('@/components/editor/use-delete-page', () => ({ useDeletePageFlow: () => vi.fn() }));
vi.mock('@/components/editor/page-trash-button', () => ({ PageTrashButton: () => null }));
vi.mock('@/components/editor/use-ai-assist-session', () => ({ useAiAssistSession: () => ({}), aiAssistPageId: () => null }));
vi.mock('@/components/editor/site-config-panel', () => ({ ConfigSectionList: () => null, ConfigSection: () => null }));
vi.mock('@/components/project-settings/shared', () => ({ ConfigDirtyProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/editor/add-language-dialog', () => ({ AddLanguageDialog: () => null }));
vi.mock('@/components/editor/ai-assist', () => ({ AiAssist: () => null }));
vi.mock('@/components/editor/branch-switcher', () => ({ BranchSwitcher: () => null }));
vi.mock('@/components/editor/comments-panel', () => ({ CommentsPanel: () => null }));
vi.mock('@/components/editor/language-settings-dialog', () => ({ LanguageSettingsDialog: () => null }));
vi.mock('@/components/editor/markdown-source-editor', () => ({ MarkdownSourceEditor: () => null }));
vi.mock('@/components/editor/page-settings-dialog', () => ({
  PageSettingsDialog: (props: { initialField?: string; page: { id: string } }) => {
    mocks.settings = props;
    return null;
  },
}));
vi.mock('@/components/editor/sortable-page-tree', () => ({
  SortablePageTree: () => null,
  PageTreeDndProvider: ({ children }: { children: ReactNode }) => children,
  LanguageDropTarget: ({ children }: { children: ReactNode }) => children,
}));

import { Route } from './editor';

const EditorRoute = Route.options.component as ComponentType;
const ROUTE_TEST_TIMEOUT = 30_000;
const OPENED_AT = '2026-11-13T22:40:22.348Z';

let container: HTMLDivElement;
let root: Root;
let mounted = false;
let scrolled: Element[];

const pageNode = (id: string, path: string, overrides: Record<string, unknown> = {}) => ({
  id,
  kind: 'PAGE',
  title: id,
  slug: path.split('/').at(-1) ?? path,
  path,
  content: '',
  languageId: ENGLISH.id,
  branchId: 'main',
  parentId: null,
  position: 0,
  icon: null,
  description: null,
  hidden: false,
  updatedAt: OPENED_AT,
  ...overrides,
});

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** Open `page-1` with `content`, as a Fix for `fix` with `fixTarget` does. */
async function open(content: string, search: { fix?: PublishCheckCode; fixTarget?: string }, overrides: Record<string, unknown> = {}) {
  const page = pageNode('page-1', 'getting-started', { title: 'Getting started', content, ...overrides });
  mocks.page = page.kind === 'GROUP' ? undefined : page;
  mocks.pages = [page, pageNode('page-guide', 'guide', { title: 'Guide', position: 1 })];
  mocks.search = { page: 'page-1', ...search };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
  await act(async () => root.render(<EditorRoute />));
  // TipTap creates the editor on a timer and seeds it in a microtask; arrival waits for frames.
  await advance(200);
}

const editor = () => (container.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapCore }) | null)?.editor;
const bar = () => container.querySelector<HTMLElement>('[data-publish-fix]');
const status = () => container.querySelector('[data-testid="publish-fix-status"]')?.textContent ?? '';
const button = (name: string) =>
  [...(bar()?.querySelectorAll('button') ?? [])].find((item) => item.textContent === name || item.getAttribute('aria-label') === name);
const count = (current: number, total: number) => `editor.fix.count ${JSON.stringify({ current, total })}`;

/** The replace navigation that dropped the Fix, applied to the address it arrived with. */
function droppedFix() {
  const call = mocks.navigate.mock.calls.find(([options]) => {
    if (!options?.replace || typeof options.search !== 'function') return false;
    const next = options.search({ ...mocks.search });
    return 'fix' in next && next.fix === undefined && next.fixTarget === undefined;
  });
  return call?.[0] as { replace: boolean; search: (previous: Record<string, unknown>) => Record<string, unknown> } | undefined;
}

/** The text of the current selection, or the selected node's type. */
const selected = () => {
  const current = editor();
  if (!current) throw new Error('No editor');
  const { selection, doc } = current.state;
  return selection instanceof NodeSelection ? `node:${selection.node.type.name}` : doc.textBetween(selection.from, selection.to, ' ');
};

beforeEach(() => {
  // Stubbed per test: afterEach unstubs every global.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mounted = false;
  mocks.navigate.mockReset();
  mocks.update.mockReset();
  mocks.update.mockImplementation(async ({ body }: { body: { content: string; title: string } }) => ({
    ...mocks.page,
    title: body.title,
    content: body.content,
    updatedAt: new Date().toISOString(),
  }));
  mocks.settings = null;
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  vi.setSystemTime(new Date('2026-11-14T09:00:00.000Z'));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, writable: true, value: () => [] });
  Object.assign(document, { elementFromPoint: () => null });
  // The selection menu (the link field) positions itself from the selection's rectangle.
  const rect = new DOMRect(0, 0, 100, 20);
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => Object.assign([rect], { item: () => rect });
});

afterEach(async () => {
  try {
    if (mounted) await act(async () => root.unmount());
  } finally {
    mounted = false;
    container?.remove();
    document.body.replaceChildren();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

const LONG = Array.from(
  { length: 40 },
  (_, index) => `Paragraph ${index + 1} of the guide, long enough to push the next link far down the page.`,
).join('\n\n');
const VIDEO = 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE';

/** Each check found by its evidence: a page holding it twice, the evidence the server sends, and what the first match selects. */
const LOCATABLE: Array<{ code: PublishCheckCode; content: string; target: string; first: string }> = [
  {
    code: 'broken-internal-link',
    content: `Read [the configuration](/configuration) first.\n\n${LONG}\n\nThen [configure **it**](/configuration), or see [the guide](/guide).`,
    target: '/configuration',
    first: 'the configuration',
  },
  {
    code: 'missing-alt',
    content: `![](/images/diagram.png)\n\n${LONG}\n\n![](/images/diagram.png)\n\n![A described image](/images/other.png)`,
    target: '/images/diagram.png',
    first: 'node:image',
  },
  {
    code: 'video-poster-hidden',
    content: `<video controls src="/demo.mp4" poster="https://cdn.example.com/poster.png"></video>\n\n${LONG}\n\n<video controls src="/other.mp4" poster="https://cdn.example.com/poster.png"></video>`,
    target: 'https://cdn.example.com/poster.png',
    first: 'node:videoEmbed',
  },
  {
    code: 'video-not-https',
    content: `<video controls src="http://cdn.example.com/demo.mp4"></video>\n\n${LONG}\n\n<video controls src="http://cdn.example.com/demo.mp4"></video>`,
    target: 'http://cdn.example.com/demo.mp4',
    first: 'node:videoEmbed',
  },
  {
    code: 'embed-as-link',
    content: `<iframe src="https://maps.example.com/embed?q=1" title="Map"></iframe>\n\n${LONG}\n\n<iframe src="https://maps.example.com/embed?q=1" title="Map again"></iframe>`,
    target: 'https://maps.example.com/embed?q=1',
    first: 'node:videoEmbed',
  },
  {
    code: 'embed-untitled',
    content: `<iframe src="${VIDEO}"></iframe>\n\n${LONG}\n\n<iframe src="${VIDEO}"></iframe>`,
    target: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
    first: 'node:videoEmbed',
  },
  {
    code: 'embed-unclosed',
    content: `<iframe src="https://maps.example.com/embed?q=2">\n\n${LONG}\n\n<iframe src="https://maps.example.com/embed?q=2">\n\nThe end.`,
    target: 'https://maps.example.com/embed?q=2',
    first: 'node:mdxOpaqueBlock',
  },
  {
    code: 'stray-characters',
    content: `Intro.\n\n/\n\n${LONG}\n\n/\n\nThe end.`,
    target: '/',
    first: '/',
  },
];

/** Where each locatable check's evidence comes from in the checks' reading of a page. */
const FACTS: Record<string, keyof PageContentFacts> = {
  'broken-internal-link': 'links',
  'missing-alt': 'imagesWithoutAlt',
  'video-poster-hidden': 'hiddenPosters',
  'video-not-https': 'insecureVideos',
  'embed-as-link': 'embedsAsLinks',
  'embed-untitled': 'untitledEmbeds',
  'embed-unclosed': 'unclosedEmbeds',
  'stray-characters': 'strayText',
};
/** How many places the publish check itself finds `target` on a page with `content`. */
const checkCount = (code: PublishCheckCode, content: string, target: string): number =>
  pageContentFacts(content, false)[FACTS[code] as keyof PageContentFacts].filter((detail) => detail === target).length;

/**
 * The evidence where the check doesn't look (a code block, inline code), then
 * once where it does. Only the prose place counts, as in the check.
 */
const IN_CODE_AND_PROSE: Array<{ code: PublishCheckCode; content: string; target: string; first: string }> = [
  {
    code: 'broken-internal-link',
    content: '```md\n[the configuration](/configuration)\n```\n\nInline `[x](/configuration)` code.\n\nRead [the configuration](/configuration).',
    target: '/configuration',
    first: 'the configuration',
  },
  {
    code: 'missing-alt',
    content:
      '```md\n![](/images/diagram.png)\n<img src="/images/diagram.png">\n```\n\nInline `![](/images/diagram.png)`.\n\n![](/images/diagram.png)',
    target: '/images/diagram.png',
    first: 'node:image',
  },
  {
    code: 'video-poster-hidden',
    content:
      '```html\n<video controls src="/a.mp4" poster="https://cdn.example.com/poster.png"></video>\n```\n\nInline `<video poster="https://cdn.example.com/poster.png">`.\n\n<video controls src="/demo.mp4" poster="https://cdn.example.com/poster.png"></video>',
    target: 'https://cdn.example.com/poster.png',
    first: 'node:videoEmbed',
  },
  {
    code: 'video-not-https',
    content:
      '```html\n<video controls src="http://cdn.example.com/demo.mp4"></video>\n```\n\nInline `<video src="http://cdn.example.com/demo.mp4">`.\n\n<video controls src="http://cdn.example.com/demo.mp4"></video>',
    target: 'http://cdn.example.com/demo.mp4',
    first: 'node:videoEmbed',
  },
  {
    code: 'embed-as-link',
    content:
      '```html\n<iframe src="https://maps.example.com/embed?q=1" title="Map"></iframe>\n```\n\nInline `<iframe src="https://maps.example.com/embed?q=1"></iframe>`.\n\n<iframe src="https://maps.example.com/embed?q=1" title="Map"></iframe>',
    target: 'https://maps.example.com/embed?q=1',
    first: 'node:videoEmbed',
  },
  {
    code: 'embed-untitled',
    content: `\`\`\`html\n<iframe src="${VIDEO}"></iframe>\n\`\`\`\n\nInline \`<iframe src="${VIDEO}"></iframe>\`.\n\n<iframe src="${VIDEO}"></iframe>`,
    target: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
    first: 'node:videoEmbed',
  },
  {
    code: 'embed-unclosed',
    content:
      '```html\n<iframe src="https://maps.example.com/embed?q=2">\n```\n\nInline `<iframe src="https://maps.example.com/embed?q=2">`.\n\n<iframe src="https://maps.example.com/embed?q=2">\n\nThe end.',
    target: 'https://maps.example.com/embed?q=2',
    first: 'node:mdxOpaqueBlock',
  },
  {
    code: 'stray-characters',
    content: '```\n/\n```\n\n`/`\n\n## /\n\nIntro.\n\n/\n\nThe end.',
    target: '/',
    first: '/',
  },
];

describe('P1-ED-002: a publish check’s Fix lands on the problem', () => {
  it.each(LOCATABLE)(
    '$code: selects the first place, says 1 of 2, Next moves on, drops the Fix with a replace, saves nothing',
    async ({ code, content, target, first }) => {
      // The publish check finds it twice too.
      expect(checkCount(code, content, target)).toBe(2);
      await open(content, { fix: code, fixTarget: target });
      expect(bar()).not.toBeNull();
      expect(status()).toContain('editor.fix.label.');
      expect(status()).toContain(target);
      expect(status()).toContain(count(1, 2));
      expect(selected()).toBe(first);
      const firstFrom = editor()?.state.selection.from ?? -1;
      // Marked in the canvas, the current one drawn stronger, and scrolled to.
      expect(container.querySelectorAll('.pl-fix-match')).not.toHaveLength(0);
      expect(container.querySelector('.pl-fix-current')).not.toBeNull();
      expect(scrolled.length).toBeGreaterThan(0);
      // Dropped from the address with a replace, so a reload doesn't land again.
      const dropped = droppedFix();
      expect(dropped?.replace).toBe(true);
      expect(dropped?.search({ page: 'page-1', fix: code, fixTarget: target })).toMatchObject({ page: 'page-1' });

      const next = button('editor.fix.next');
      if (!next) throw new Error('No Next');
      await act(async () => next.click());
      expect(status()).toContain(count(2, 2));
      expect(editor()?.state.selection.from).toBeGreaterThan(firstFrom);
      await act(async () => next.click());
      expect(status()).toContain(count(1, 2));
      expect(editor()?.state.selection.from).toBe(firstFrom);

      // Arriving and moving between the places is not an edit.
      await advance(20_000);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain('editor.savingShort');
    },
    ROUTE_TEST_TIMEOUT,
  );

  it.each(IN_CODE_AND_PROSE)(
    '$code: evidence inside code is not a place to fix; only the prose one counts, as in the check',
    async ({ code, content, target, first }) => {
      expect(checkCount(code, content, target)).toBe(1);
      await open(content, { fix: code, fixTarget: target });
      expect(status()).toContain(count(1, 1));
      expect(selected()).toBe(first);
      const current = editor();
      if (!current) throw new Error('No editor');
      // The selection is in the prose, never in the code block or inline code.
      const { $from } = current.state.selection;
      expect($from.parent.type.name).not.toBe('codeBlock');
      expect(current.state.doc.textBetween(current.state.selection.from, current.state.selection.to, ' ')).not.toContain('`');
      for (const mark of $from.marks()) expect(mark.type.name).not.toBe('code');
      expect(container.querySelectorAll('.pl-fix-match')).toHaveLength(1);
      expect(container.querySelector('pre .pl-fix-match, code .pl-fix-match')).toBeNull();
      await advance(20_000);
      expect(mocks.update).not.toHaveBeenCalled();
    },
    ROUTE_TEST_TIMEOUT,
  );

  it('a broken link on a Card focuses the Card’s own address field', async () => {
    const content = 'Intro.\n\n<CardGroup>\n  <Card title="Configure" href="/configuration">\n    Set it up.\n  </Card>\n</CardGroup>';
    expect(checkCount('broken-internal-link', content, '/configuration')).toBe(1);
    await open(content, { fix: 'broken-internal-link', fixTarget: '/configuration' });
    expect(status()).toContain(count(1, 1));
    expect(selected()).toBe('node:mdxCard');
    const address = document.activeElement as HTMLInputElement | null;
    expect(address?.dataset.attribute).toBe('href');
    expect(address?.value).toBe('/configuration');
    await advance(20_000);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('opens the link field on a broken link, ready to pick the page it should lead to', async () => {
    await open(LOCATABLE[0]?.content ?? '', { fix: 'broken-internal-link', fixTarget: '/configuration' });
    await advance(500);
    const field = document.querySelector<HTMLInputElement>('[data-editor-bubble-menu] input[role="combobox"]');
    expect(field?.value).toBe('/configuration');
    expect(document.activeElement).toBe(field);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('says plainly when the evidence is no longer on the page, without an error', async () => {
    await open('Read [the guide](/guide).', { fix: 'broken-internal-link', fixTarget: '/configuration' });
    expect(status()).toContain('editor.fix.notFound');
    expect(status()).not.toContain('editor.fix.count');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('.pl-fix-match')).toBeNull();
    expect(droppedFix()?.replace).toBe(true);
    await advance(20_000);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('Escape closes the bar and clears the marks; Back to publish asks for ?publish=true', async () => {
    await open(LOCATABLE[7]?.content ?? '', { fix: 'stray-characters', fixTarget: '/' });
    const back = button('editor.fix.back');
    await act(async () => back?.click());
    const publish = mocks.navigate.mock.calls.map(([options]) => options).find((options) => options?.search?.({ page: 'page-1' })?.publish === true);
    expect(publish?.replace).toBe(true);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(bar()).toBeNull();
    expect(container.querySelector('.pl-fix-match')).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('the bar is announced politely and reachable by keyboard', async () => {
    await open(LOCATABLE[0]?.content ?? '', { fix: 'broken-internal-link', fixTarget: '/configuration' });
    const region = bar();
    // A named section: a region landmark.
    expect(region?.tagName).toBe('SECTION');
    expect(region?.getAttribute('aria-label')).toBe('editor.fix.region');
    expect(region?.querySelector('[aria-live="polite"]')?.textContent).toContain(count(1, 2));
    for (const name of ['editor.fix.next', 'editor.fix.back', 'editor.fix.dismiss']) {
      const control = button(name);
      expect(control?.tagName).toBe('BUTTON');
      expect(control?.tabIndex).toBe(0);
    }
  });

  it.each(['untitled-page', 'duplicate-title'] as const)('%s focuses the title', async (code) => {
    await open('Body text.', { fix: code });
    expect(document.activeElement).toBe(container.querySelector('textarea[aria-label="editor.pageTitlePlaceholder"]'));
    expect(status()).toContain('editor.fix.explain.');
    expect(droppedFix()?.replace).toBe(true);
    await advance(20_000);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('empty-page focuses the body', async () => {
    await open('', { fix: 'empty-page' });
    expect(document.activeElement).toBe(container.querySelector('.ProseMirror'));
    expect(status()).toContain('editor.fix.explain.emptyPage');
    await advance(20_000);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('unreadable-slug opens the page’s address field in Page settings', async () => {
    await open('Body text.', { fix: 'unreadable-slug' });
    expect(mocks.settings?.page.id).toBe('page-1');
    expect(mocks.settings?.initialField).toBe('slug');
    expect(status()).toContain('editor.fix.explain.unreadableSlug');
    expect(droppedFix()?.replace).toBe(true);
  });

  it('home-untranslated explains, with nothing to focus', async () => {
    await open('Welcome.', { fix: 'home-untranslated' });
    expect(status()).toContain('editor.fix.explain.homeUntranslated');
    expect(document.activeElement).toBe(document.body);
    expect(mocks.settings).toBeNull();
    expect(droppedFix()?.replace).toBe(true);
  });

  it('blog-root-group explains on the group, with nothing to focus', async () => {
    await open('', { fix: 'blog-root-group' }, { kind: 'GROUP', title: 'Blog' });
    expect(status()).toContain('editor.fix.explain.blogRootGroup');
    expect(document.activeElement).toBe(document.body);
    expect(droppedFix()?.replace).toBe(true);
  });

  it('a locatable check without its evidence (shortened by the server) still names the problem', async () => {
    await open('Read [the guide](/guide).', { fix: 'broken-internal-link' });
    expect(status()).toContain('editor.fix.label.brokenLink');
    expect(status()).toContain('editor.fix.findOnPage');
  });
});

describe('P1-ED-002: links to a missing page are flagged while writing', () => {
  const CONTENT = 'See [the configuration](/configuration) and [the guide](/guide).';
  /** The hrefs flagged in the canvas, in order. */
  const flags = () => [...container.querySelectorAll<HTMLElement>('.pl-broken-link')].map((element) => element.dataset.brokenLink);
  /** Select the text of the first link to `href`. */
  const selectLink = (current: TiptapCore, href: string) => {
    let range: { from: number; to: number } | null = null;
    current.state.doc.descendants((node, pos) => {
      if (!range && node.isText && node.marks.some((mark) => mark.attrs.href === href)) range = { from: pos, to: pos + node.nodeSize };
      return !range;
    });
    if (!range) throw new Error(`No link to ${href}`);
    current.commands.setTextSelection(range);
  };
  const setHref = (current: TiptapCore, from: string, to: string) =>
    act(async () => {
      selectLink(current, from);
      current.chain().extendMarkRange('link').setLink({ href: to }).run();
    });

  it('flags a link whose page does not exist, not one that does, and never saves the flag', async () => {
    await open(CONTENT, {});
    const flagged = container.querySelector<HTMLElement>('.pl-broken-link');
    expect(flagged?.textContent).toBe('the configuration');
    expect(flagged?.getAttribute('title')).toBe('Page not found: /configuration');
    expect(flags()).toEqual(['/configuration']);
    const current = editor();
    if (!current) throw new Error('No editor');
    // A decoration only: the Markdown is the page's own.
    expect(getMarkdown(current)).toBe(CONTENT);
    expect(getMarkdown(current)).not.toContain('Page not found');
    // Writing a new link to a missing page flags it as it is written.
    await act(async () => {
      current.chain().focus('end').insertContent(' <a href="/nowhere">Nowhere</a>').run();
    });
    expect(flags()).toEqual(['/configuration', '/nowhere']);
  });

  it('the route resolves links with a stable resolver: re-renders build none', async () => {
    await open(CONTENT, {});
    const built = mocks.resolvers;
    const current = editor();
    if (!current) throw new Error('No editor');
    // Typing re-renders the route (the draft changes) several times.
    await act(async () => {
      current.chain().focus('end').insertContent(' More.').run();
    });
    await advance(5000);
    expect(mocks.resolvers).toBe(built);
  });

  it('changing a link’s page clears or raises its flag (a mark-only edit), and the save carries no trace of it', async () => {
    await open(CONTENT, {});
    const current = editor();
    if (!current) throw new Error('No editor');
    await setHref(current, '/configuration', '/guide');
    expect(flags()).toEqual([]);
    await setHref(current, '/guide', '/missing-page');
    expect(flags()).toEqual(['/missing-page']);
    await advance(5000);
    const saved = mocks.update.mock.calls.at(-1)?.[0]?.body?.content as string;
    expect(saved).toBe('See [the configuration](/missing-page) and [the guide](/guide).');
  });

  it('through the link field, undo and redo', async () => {
    await open(CONTENT, { fix: 'broken-internal-link', fixTarget: '/configuration' });
    await advance(500);
    // Arrival opened the link field on the broken link; pick a page that exists.
    const field = document.querySelector<HTMLInputElement>('[data-editor-bubble-menu] input[role="combobox"]');
    if (!field) throw new Error('No link field');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '/guide');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    const current = editor();
    if (!current) throw new Error('No editor');
    expect(getMarkdown(current)).toBe('See [the configuration](/guide) and [the guide](/guide).');
    expect(flags()).toEqual([]);
    await act(async () => {
      current.commands.undo();
    });
    expect(getMarkdown(current)).toBe(CONTENT);
    expect(flags()).toEqual(['/configuration']);
    await act(async () => {
      current.commands.redo();
    });
    expect(flags()).toEqual([]);
  });

  it('pasting a link over a link flags the pasted one when its page is missing', async () => {
    // jsdom has no ClipboardEvent: a plain paste event carries the HTML instead.
    const paste = () => new Event('paste') as ClipboardEvent;
    await open(CONTENT, {});
    const current = editor();
    if (!current) throw new Error('No editor');
    await act(async () => {
      selectLink(current, '/guide');
      current.view.pasteHTML('<a href="/elsewhere">elsewhere</a>', paste());
    });
    expect(getMarkdown(current)).toContain('[elsewhere](/elsewhere)');
    expect(flags()).toEqual(['/configuration', '/elsewhere']);
    await act(async () => {
      selectLink(current, '/configuration');
      current.view.pasteHTML('<a href="/guide">the guide again</a>', paste());
    });
    expect(flags()).toEqual(['/elsewhere']);
  });
});
