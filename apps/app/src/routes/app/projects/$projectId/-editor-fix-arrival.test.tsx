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

// The publish checks' own reading of a page: the oracle for every count (and loaded here, so the bar's lazy import is ready).
import { collectPageContentFacts, type PageContentFacts } from '@nibleaf/shared/page-content-facts';
import type { PublishCheckCode } from '@nibleaf/shared/publish-check-codes';
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
/** Where the page's scroller was asked to scroll, and which element scrolled. */
let scrolledTo: Array<{ scroller: Element; top: number }>;

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
/** The place the bar is on: `inside` when it is marked inside a block kept as written (never selected), else the selection. */
const place = () => (container.querySelector('.pl-fix-current')?.matches('[data-mdx-opaque]') ? 'inside' : selected());
/** Which match is drawn as the current one (1-based). */
const currentMatch = () => container.querySelector<HTMLElement>('.pl-fix-current')?.dataset.fixMatch;

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
  scrolledTo = [];
  // jsdom has no layout: record where the bar asks the page's scroller to go.
  Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
    scrolled.push(this);
    scrolledTo.push({ scroller: this, top: typeof options === 'object' ? (options.top ?? 0) : 0 });
  } as Element['scrollTo'];
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
    delete (Element.prototype as { scrollTo?: unknown }).scrollTo;
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
    first: 'inside',
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
  collectPageContentFacts(content)[FACTS[code] as keyof PageContentFacts].filter((detail) => detail === target).length;

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
    first: 'inside',
  },
  {
    code: 'stray-characters',
    content: '```\n/\n```\n\n`/`\n\n## /\n\nIntro.\n\n/\n\nThe end.',
    target: '/',
    first: '/',
  },
];

const KEEP_AROUND = (block: string) => `Before \`KEEP\`.\n\n${block}\n\nAfter \`KEEP\`.`;
const WITHOUT_BLOCK = 'Before `KEEP`.\n\nAfter `KEEP`.';

/** Each check's finding beside inline code, and the page once the selection is deleted: only the finding is gone. */
const DELETE_ONLY_THE_FINDING: Array<{ name: string; code: PublishCheckCode; content: string; target: string; after: string }> = [
  {
    name: 'broken-internal-link (a link between inline code)',
    code: 'broken-internal-link',
    content: 'Start `KEEP` [the configuration](/configuration) `KEEP` end.',
    target: '/configuration',
    after: 'Start `KEEP`  `KEEP` end.',
  },
  {
    name: 'stray-characters (a slash after inline code)',
    code: 'stray-characters',
    content: 'Before.\n\n`KEEP` /\n\nAfter.',
    target: '/',
    after: 'Before.\n\n`KEEP` \n\nAfter.',
  },
  {
    name: 'missing-alt',
    code: 'missing-alt',
    content: KEEP_AROUND('![](/images/diagram.png)'),
    target: '/images/diagram.png',
    after: WITHOUT_BLOCK,
  },
  {
    name: 'video-poster-hidden',
    code: 'video-poster-hidden',
    content: KEEP_AROUND('<video controls src="/demo.mp4" poster="https://cdn.example.com/poster.png"></video>'),
    target: 'https://cdn.example.com/poster.png',
    after: WITHOUT_BLOCK,
  },
  {
    name: 'video-not-https',
    code: 'video-not-https',
    content: KEEP_AROUND('<video controls src="http://cdn.example.com/demo.mp4"></video>'),
    target: 'http://cdn.example.com/demo.mp4',
    after: WITHOUT_BLOCK,
  },
  {
    name: 'embed-as-link',
    code: 'embed-as-link',
    content: KEEP_AROUND('<iframe src="https://maps.example.com/embed?q=1" title="Map"></iframe>'),
    target: 'https://maps.example.com/embed?q=1',
    after: WITHOUT_BLOCK,
  },
  {
    name: 'embed-untitled',
    code: 'embed-untitled',
    content: KEEP_AROUND(`<iframe src="${VIDEO}"></iframe>`),
    target: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
    after: WITHOUT_BLOCK,
  },
];

/** Findings in blocks the editor keeps as source, alone and mixed with prose: the check's count, and the places Next visits. */
const COUNTED_BY_THE_CHECK: Array<{ name: string; code: PublishCheckCode; content: string; target: string; places: string[] }> = [
  {
    name: 'a link in an MDX module, then in prose',
    code: 'broken-internal-link',
    content: 'export const example = "[broken](/configuration)";\n\n[broken](/configuration)',
    target: '/configuration',
    places: ['inside', 'broken'],
  },
  {
    name: 'two images in one unsupported component',
    code: 'missing-alt',
    content: 'Intro.\n\n<Unknown>\n\n![](/images/a.png)\n\n![](/images/a.png)\n\n</Unknown>',
    target: '/images/a.png',
    places: ['inside', 'inside'],
  },
  {
    name: 'prose, a component whose href is not a link, prose',
    code: 'broken-internal-link',
    content: 'Read [first](/configuration).\n\n<Unknown href="/configuration">Not a link</Unknown>\n\nThen [second](/configuration).',
    target: '/configuration',
    places: ['first', 'second'],
  },
  {
    name: 'prose, then a link the editor shows as code alone',
    code: 'broken-internal-link',
    content: 'Read [first](/configuration).\n\nRun [`setup`](/configuration) first.',
    target: '/configuration',
    places: ['first'],
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
      expect(place()).toBe(first);
      expect(currentMatch()).toBe('1');
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
      expect(currentMatch()).toBe('2');
      await act(async () => next.click());
      expect(status()).toContain(count(1, 2));
      expect(currentMatch()).toBe('1');
      expect(place()).toBe(first);

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
      expect(place()).toBe(first);
      const current = editor();
      if (!current) throw new Error('No editor');
      if (first !== 'inside') {
        // The selection is in the prose, never in the code block or inline code.
        const { $from } = current.state.selection;
        expect($from.parent.type.name).not.toBe('codeBlock');
        expect(current.state.doc.textBetween(current.state.selection.from, current.state.selection.to, ' ')).not.toContain('`');
        for (const mark of $from.marks()) expect(mark.type.name).not.toBe('code');
      }
      expect(container.querySelectorAll('.pl-fix-match')).toHaveLength(1);
      expect(container.querySelector('pre .pl-fix-match, code .pl-fix-match')).toBeNull();
      await advance(20_000);
      expect(mocks.update).not.toHaveBeenCalled();
    },
    ROUTE_TEST_TIMEOUT,
  );

  it.each(DELETE_ONLY_THE_FINDING)(
    '$name: deleting the selection removes the finding and nothing else',
    async ({ code, content, target, after }) => {
      expect(checkCount(code, content, target)).toBe(1);
      await open(content, { fix: code, fixTarget: target });
      expect(status()).toContain(count(1, 1));
      const current = editor();
      if (!current) throw new Error('No editor');
      await act(async () => {
        current.commands.deleteSelection();
      });
      // Every other byte of the page is as it was.
      expect(getMarkdown(current)).toBe(after);
    },
    ROUTE_TEST_TIMEOUT,
  );

  it.each(COUNTED_BY_THE_CHECK)(
    '$name: the bar counts what the check counts, and Next visits every place it can show',
    async ({ code, content, target, places }) => {
      const total = checkCount(code, content, target);
      await open(content, { fix: code, fixTarget: target });
      expect(status()).toContain(count(1, total));
      const visited = [place()];
      for (let index = 1; index < places.length; index += 1) {
        const next = button('editor.fix.next');
        await act(async () => next?.click());
        await advance(0);
        expect(status()).toContain(count(index + 1, total));
        visited.push(place());
      }
      expect(visited).toEqual(places);
      if (places.length < total) expect(status()).toContain(`editor.fix.placed ${JSON.stringify({ placed: places.length, total })}`);
      else expect(status()).not.toContain('editor.fix.placed');
      await advance(20_000);
      expect(mocks.update).not.toHaveBeenCalled();
    },
    ROUTE_TEST_TIMEOUT,
  );

  it('a finding the editor cannot show is still counted, and the bar says so', async () => {
    // The editor shows a link whose label is inline code as code alone (a known round-trip loss on main): the check still finds the link.
    const content = 'Run [`setup`](/configuration) first.';
    expect(checkCount('broken-internal-link', content, '/configuration')).toBe(1);
    await open(content, { fix: 'broken-internal-link', fixTarget: '/configuration' });
    expect(status()).toContain(`editor.fix.placed ${JSON.stringify({ placed: 0, total: 1 })}`);
    expect(status()).not.toContain('editor.fix.notFound');
    expect(container.querySelector('.pl-fix-match')).toBeNull();
    expect(droppedFix()?.replace).toBe(true);
  });

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

/** Each check's evidence as Markdown and as HTML, for the blocks the editor keeps as written. */
const INSIDE_EVIDENCE: Array<{ code: PublishCheckCode; target: string; md: string; html: string }> = [
  { code: 'broken-internal-link', target: '/configuration', md: '[broken](/configuration)', html: '<a href="/configuration">broken</a>' },
  { code: 'missing-alt', target: '/images/a.png', md: '![](/images/a.png)', html: '<img src="/images/a.png">' },
  {
    code: 'video-poster-hidden',
    target: 'https://cdn.example.com/poster.png',
    md: '<video controls src="/demo.mp4" poster="https://cdn.example.com/poster.png"></video>',
    html: '<video controls src="/demo.mp4" poster="https://cdn.example.com/poster.png"></video>',
  },
  {
    code: 'video-not-https',
    target: 'http://cdn.example.com/demo.mp4',
    md: '<video controls src="http://cdn.example.com/demo.mp4"></video>',
    html: '<video controls src="http://cdn.example.com/demo.mp4"></video>',
  },
  {
    code: 'embed-as-link',
    target: 'https://maps.example.com/embed?q=1',
    md: '<iframe src="https://maps.example.com/embed?q=1" title="Map"></iframe>',
    html: '<iframe src="https://maps.example.com/embed?q=1" title="Map"></iframe>',
  },
  {
    code: 'embed-untitled',
    target: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
    md: `<iframe src="${VIDEO}"></iframe>`,
    html: `<iframe src="${VIDEO}"></iframe>`,
  },
  {
    code: 'embed-unclosed',
    target: 'https://maps.example.com/embed?q=2',
    md: '<iframe src="https://maps.example.com/embed?q=2">',
    html: '<iframe src="https://maps.example.com/embed?q=2">',
  },
  { code: 'stray-characters', target: '/', md: '/', html: '<p>/</p>' },
];
/** The blocks the editor keeps as written, each with other content (`KEEP`) around the finding. */
const CONTAINERS: Array<{ container: string; wrap: (evidence: { md: string; html: string }) => string }> = [
  {
    container: 'an unsupported MDX component',
    wrap: ({ md }) => `Intro.\n\n<Unknown>\n\nKEEP BEFORE\n\n${md}\n\nKEEP AFTER\n\n</Unknown>\n\nOutro.`,
  },
  {
    container: 'a raw HTML block',
    wrap: ({ html }) => `Intro.\n\n<div class="keep">\n<p>KEEP BEFORE</p>\n${html}\n<p>KEEP AFTER</p>\n</div>\n\nOutro.`,
  },
  { container: 'an ESM export', wrap: ({ md }) => `Intro.\n\nexport const example = { keep: "KEEP", value: ${JSON.stringify(md)} };\n\nOutro.` },
];
/**
 * Every pairing the check reports (it counts 1). The others are not findings at
 * all: in an ESM export the check reads only links, and a `<p>/</p>` inside an
 * HTML block is not stray text to it.
 */
const INSIDE_A_BLOCK = CONTAINERS.flatMap(({ container, wrap }) =>
  INSIDE_EVIDENCE.map(({ code, target, ...evidence }) => ({ name: `${code} in ${container}`, code, target, content: wrap(evidence) })),
).filter(({ code, content, target }) => checkCount(code, content, target) === 1);

/** The writer presses `key` wherever focus is (as a keyboard does). */
const press = (key: string) =>
  act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
/** The writer types `character`: it reaches the page only when focus is in it, at its caret. */
async function type(character: string) {
  await press(character);
  const current = editor();
  if (current?.view.dom.contains(document.activeElement)) {
    await act(async () => {
      current.commands.insertContent(character);
    });
  }
}
/** The opaque block's own source, as kept in the document. */
const blockSources = () => {
  const sources: string[] = [];
  editor()?.state.doc.descendants((node) => {
    if (node.type.name === 'mdxOpaqueBlock') sources.push(String(node.attrs.source));
    return true;
  });
  return sources;
};

describe('P1-ED-002: the bar on a narrow screen (390 px)', () => {
  const LONG_LINK = '/configuration/advanced/networking/proxy-settings';
  const content = `Read [the settings](${LONG_LINK}) first.`;

  it('the evidence is one line, cut with an ellipsis, left to right, with its full value kept', async () => {
    await open(content, { fix: 'broken-internal-link', fixTarget: LONG_LINK });
    const evidence = container.querySelector<HTMLElement>('[data-testid="publish-fix-evidence"]');
    expect(evidence?.getAttribute('dir')).toBe('ltr');
    expect(evidence?.getAttribute('title')).toBe(LONG_LINK);
    // The whole address is still its text (read out in full); only its display is cut.
    expect(evidence?.textContent).toBe(LONG_LINK);
    const classes = evidence?.className.split(/\s+/) ?? [];
    expect(classes).toEqual(expect.arrayContaining(['truncate', 'inline-block', 'max-w-full']));
    expect(classes).not.toContain('break-all');
  });

  it('the status takes its own row and the buttons wrap below it; their order is unchanged', async () => {
    await open(content, { fix: 'broken-internal-link', fixTarget: LONG_LINK });
    const status = container.querySelector<HTMLElement>('[data-testid="publish-fix-status"]');
    // A 16rem basis: wider than what is left beside the buttons at 390 px, so it wraps onto a row of its own.
    expect(status?.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex-1', 'basis-64', 'min-w-0']));
    expect(bar()?.className.split(/\s+/)).toContain('flex-wrap');
    const actions = container.querySelector<HTMLElement>('[data-testid="publish-fix-actions"]');
    expect(actions?.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'max-w-full']));
    expect(actions?.className.split(/\s+/)).not.toContain('shrink-0');
    // Keyboard order: Previous, Next, Back to publish, Close.
    expect([...(actions?.querySelectorAll('button') ?? [])].map((item) => item.textContent || item.getAttribute('aria-label'))).toEqual([
      'editor.fix.previous',
      'editor.fix.next',
      'editor.fix.back',
      'editor.fix.dismiss',
    ]);
  });

  it('the landed link scrolls in below the bar, by the bar’s height plus a gap', async () => {
    // Layout, as at 390 px: the bar is 96 px tall, the scroller starts 150 px down, the link sits 900 px down.
    const rect = (top: number, height: number) =>
      ({ top, height, bottom: top + height, left: 0, right: 390, width: 390, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.matches('[data-publish-fix]')) return rect(56, 96);
      if (this.closest('.ProseMirror')) return rect(900, 20);
      return rect(150, 600);
    };
    try {
      await open(content, { fix: 'broken-internal-link', fixTarget: LONG_LINK });
      const landing = scrolledTo.at(-1);
      // 900 − 150 + scrollTop (0) − (96 + 16): the link sits 112 px under the scroller's top, clear of the bar, with the room below for the link field.
      expect(landing?.top).toBe(900 - 150 - (96 + 16));
      expect(landing?.scroller.contains(container.querySelector('.ProseMirror'))).toBe(true);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});

describe('P1-ED-002: a finding inside a block the visual editor keeps as written', () => {
  it('covers every code, and every kind of block', () => {
    expect(new Set(INSIDE_A_BLOCK.map(({ code }) => code))).toEqual(new Set(INSIDE_EVIDENCE.map(({ code }) => code)));
    expect(INSIDE_A_BLOCK.some(({ name }) => name.includes('MDX component'))).toBe(true);
    expect(INSIDE_A_BLOCK.some(({ name }) => name.includes('raw HTML'))).toBe(true);
    expect(INSIDE_A_BLOCK.some(({ name }) => name.includes('ESM'))).toBe(true);
    expect(INSIDE_A_BLOCK).toHaveLength(16);
  });

  it.each(INSIDE_A_BLOCK)(
    '$name: marked, never selected; Delete, Backspace and typing change nothing in the block',
    async ({ code, content, target }) => {
      await open(content, { fix: code, fixTarget: target });
      expect(status()).toContain(count(1, 1));
      expect(status()).toContain('editor.fix.insideBlock');
      expect(place()).toBe('inside');
      const current = editor();
      if (!current) throw new Error('No editor');
      // The block is not selected, and focus is on the way to fix it, not in the page.
      expect(current.state.selection instanceof NodeSelection).toBe(false);
      expect(document.activeElement?.textContent).toBe('editor.editSource');
      const before = getMarkdown(current);
      const sources = blockSources();
      expect(sources.join('\n')).toContain('KEEP');
      await press('Delete');
      await press('Backspace');
      await type('x');
      // Byte for byte: nothing reached the block (focus was never in the page, so nothing was typed into it).
      expect(getMarkdown(current)).toBe(before);
      expect(blockSources()).toEqual(sources);
      await advance(20_000);
      expect(mocks.update).not.toHaveBeenCalled();
    },
    ROUTE_TEST_TIMEOUT,
  );

  it('Next and Previous step over a finding in a block without selecting it, and the writer’s selection stays', async () => {
    const content = 'Read [first](/configuration).\n\n<Unknown>\n\nKEEP\n\n[inside](/configuration)\n\n</Unknown>\n\nThen [second](/configuration).';
    expect(checkCount('broken-internal-link', content, '/configuration')).toBe(3);
    await open(content, { fix: 'broken-internal-link', fixTarget: '/configuration' });
    const current = editor();
    if (!current) throw new Error('No editor');
    const before = getMarkdown(current);
    // As a click or a key press on the button does: focus moves to it (jsdom's click() alone doesn't).
    const step = async (name: string) => {
      const control = button(name);
      await act(async () => {
        control?.focus();
        control?.click();
      });
      await advance(0);
    };
    expect(place()).toBe('first');
    await step('editor.fix.next');
    // Marked and counted, never selected: the selection is still the writer's (the first link).
    expect(status()).toContain(count(2, 3));
    expect(place()).toBe('inside');
    expect(selected()).toBe('first');
    expect(current.state.selection instanceof NodeSelection).toBe(false);
    await step('editor.fix.next');
    expect(status()).toContain(count(3, 3));
    expect(place()).toBe('second');
    await step('editor.fix.previous');
    expect(status()).toContain(count(2, 3));
    expect(place()).toBe('inside');
    expect(selected()).toBe('second');
    await step('editor.fix.previous');
    expect(place()).toBe('first');
    // Keys pressed on the bar's controls never reach the page.
    await step('editor.fix.next');
    await press('Delete');
    await type('x');
    expect(getMarkdown(current)).toBe(before);
    await advance(20_000);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('Edit as Markdown opens the page’s source, where the block can be changed', async () => {
    await open('Intro.\n\n<Unknown>\n\nKEEP\n\n[inside](/configuration)\n\n</Unknown>', { fix: 'broken-internal-link', fixTarget: '/configuration' });
    const editSource = button('editor.editSource');
    expect(editSource).toBeDefined();
    await act(async () => editSource?.click());
    // The visual editor gives way to the Markdown source (mocked here).
    expect(container.querySelector('.ProseMirror')).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
