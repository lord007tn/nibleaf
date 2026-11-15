// @vitest-environment jsdom
/**
 * P2-ED-005, end to end in the editor route: the real TipTap editor, the real
 * autosave (editor-save-throttle) and save queue, a mocked API and fake timers.
 *
 * Typing on a large page lagged: each keystroke serialized the whole page, the
 * route re-rendered and scanned it, and the editor searched it for comments,
 * counted its words and walked it for code highlighting. Now a keystroke only
 * notes the edit, and the page is serialized when a save is due, a flush runs or
 * typing pauses.
 *
 * - The work counters per keystroke stay flat from 18 to 72 KB (they grew 4×
 *   before: this test fails on the code before the change).
 * - Saves happen at the same moments with the same content as before, through
 *   every path that saves or flushes (these pass on the code before the change
 *   too: guards).
 */

import {
  STARTER_API_CREATE_WIDGET_CONTENT,
  STARTER_COMPONENTS_TOUR_CONTENT,
  STARTER_FAQ_CONTENT,
  STARTER_GETTING_STARTED_CONTENT,
  STARTER_INSTALLATION_CONTENT,
} from '@nibleaf/auth/starter-content';
import type { Editor as TiptapCore } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { MarkdownSerializerState } from 'prosemirror-markdown';
import { act, type ComponentType, Profiler, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HARD_WRAPPED_AR, HARD_WRAPPED_EN, IMPORTED_INTRODUCTION, IMPORTED_QUICKSTART } from '@/components/editor/__fixtures__/hard-wrapped-pages';
import { getMarkdown } from '@/components/editor/tiptap-editor';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  update: vi.fn(),
  page: undefined as Record<string, unknown> | undefined,
  pages: [] as Array<Record<string, unknown>>,
  languages: [] as Array<Record<string, unknown>>,
  blocker: null as null | { shouldBlockFn: () => Promise<boolean> },
  /** What the page query's refetch returns (the conflict review asks for it). */
  refetched: undefined as Record<string, unknown> | undefined,
  ai: null as null | { onContentChange: (content: string) => void },
  conflictDialog: null as null | { onResolve: (merged: { title: string; content: string }) => void },
  history: null as null | { onRestored: (page: Record<string, unknown>) => void },
  comments: [] as Array<{ id: string; resolved: boolean; anchor: { quote: string } }>,
  tree: null as unknown,
  publish: null as null | { beforePublish: () => Promise<boolean> },
  /** The route's unsupported-tag scans: how many, and the characters scanned. */
  scan: { calls: 0, chars: 0 },
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: 'en', t: (key: string) => key }),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ projectId: 'project-1' }),
    useSearch: () => ({}),
    useNavigate: () => mocks.navigate,
  }),
  useBlocker: (options: { shouldBlockFn: () => Promise<boolean> }) => {
    mocks.blocker = options;
  },
  useRouter: () => ({ buildLocation: () => ({ href: '' }) }),
  Link: ({ children, to: _to, params: _params, ...props }: { children: ReactNode; to: string; params: unknown }) => <a {...props}>{children}</a>,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn(), usePrompt: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: () => undefined }),
  useQueries: ({ combine }: { combine: (results: unknown[]) => unknown }) => combine([]),
}));
vi.mock('@/components/editor/linked-page-history', () => ({ useLinkedPageHistory: () => vi.fn() }));
vi.mock('@/hooks/api', async () => ({
  useProject: () => ({ data: { id: 'project-1', name: 'Test site', config: {} } }),
  useProjectMembers: () => ({ data: { members: [{ role: 'member', user: { id: 'user-1' } }] }, isPending: false }),
  useAiDraftCapability: () => ({ isPending: false, data: undefined }),
  addressMayFollowTitle: () => false,
  friendlyErrorMessage: (await import('@/hooks/api/errors')).friendlyErrorMessage,
  pageNeverPublished: () => false,
  pagePublishState: () => 'unchanged',
  queryKeys: (await import('@/hooks/api/query-keys')).queryKeys,
  useBranches: () => ({}),
  useOpenApiConfiguration: () => ({}),
  useLanguages: () => ({ data: mocks.languages }),
  usePages: () => ({ data: mocks.pages, isPending: false }),
  usePage: () => ({ data: mocks.page, refetch: async () => ({ data: mocks.refetched ?? mocks.page }) }),
  usePendingChanges: () => ({}),
  useComments: () => ({ data: mocks.comments }),
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
vi.mock('@/layouts/project', () => ({
  PublishControl: (props: { beforePublish: () => Promise<boolean> }) => {
    mocks.publish = props;
    return null;
  },
}));
vi.mock('@/components/editor/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('@/components/editor/use-delete-page', () => ({ useDeletePageFlow: () => vi.fn() }));
vi.mock('@/components/editor/page-trash-button', () => ({ PageTrashButton: () => null }));
// The re-seed paths (#630): AI assist hands the route new content, the conflict
// dialog a merge, and History a restored page. Each is captured to drive by hand.
vi.mock('@/components/editor/use-ai-assist-session', () => ({
  useAiAssistSession: (options: { onContentChange: (content: string) => void }) => {
    mocks.ai = options;
    return {};
  },
  aiAssistPageId: () => null,
}));
vi.mock('@/components/editor/editor-conflict-dialog', () => ({
  EditorConflictDialog: (props: { onResolve: (merged: { title: string; content: string }) => void }) => {
    mocks.conflictDialog = props;
    return null;
  },
}));
vi.mock('@/components/editor/page-history-panel', () => ({
  default: (props: { onRestored: (page: Record<string, unknown>) => void }) => {
    mocks.history = props;
    return null;
  },
}));
// Menus are open, so a test can press "History" (their items render in a portal).
vi.mock('@nibleaf/design-system/components/ui/dropdown-menu', async (importOriginal) => {
  const real = await importOriginal<typeof import('@nibleaf/design-system/components/ui/dropdown-menu')>();
  const Open = (props: React.ComponentProps<typeof real.DropdownMenu>) => <real.DropdownMenu {...props} open />;
  return { ...real, DropdownMenu: Open };
});
vi.mock('@/components/editor/site-config-panel', () => ({ ConfigSectionList: () => null, ConfigSection: () => null }));
vi.mock('@/components/project-settings/shared', () => ({ ConfigDirtyProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/editor/add-language-dialog', () => ({ AddLanguageDialog: () => null }));
vi.mock('@/components/editor/ai-assist', () => ({ AiAssist: () => null }));
vi.mock('@/components/editor/branch-switcher', () => ({ BranchSwitcher: () => null }));
vi.mock('@/components/editor/comments-panel', () => ({ CommentsPanel: () => null }));
vi.mock('@/components/editor/language-settings-dialog', () => ({ LanguageSettingsDialog: () => null }));
vi.mock('@/components/editor/markdown-source-editor', () => ({ MarkdownSourceEditor: () => null }));
vi.mock('@/components/editor/page-settings-dialog', () => ({ PageSettingsDialog: () => null }));
vi.mock('@/components/editor/unsupported-mdx', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/components/editor/unsupported-mdx')>();
  return {
    ...real,
    detectUnsupportedMdxTags: (content: string) => {
      mocks.scan.calls += 1;
      mocks.scan.chars += content.length;
      return real.detectUnsupportedMdxTags(content);
    },
  };
});
vi.mock('@/components/editor/sortable-page-tree', () => ({
  SortablePageTree: (props: Record<string, unknown>) => {
    mocks.tree = props;
    return null;
  },
  PageTreeDndProvider: ({ children }: { children: ReactNode }) => children,
  LanguageDropTarget: ({ children }: { children: ReactNode }) => children,
}));

import { Route } from './editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const EditorRoute = Route.options.component as ComponentType;

const ENGLISH = { id: 'lang-en', code: 'en', label: 'English', isDefault: true, direction: 'LTR' };
const OPENED_AT = '2026-11-13T22:40:22.348Z';
const ROUTE_TEST_TIMEOUT = 60_000;
/** The editor serializes a deferred edit after this pause (DEFERRED_EMIT_IDLE_MS). */
const SERIALIZE_PAUSE = 300;

let server: { content: string; updatedAt: string; patches: Array<{ at: number; content: string; expectedUpdatedAt?: string }> };
let container: HTMLDivElement;
let root: Root;
let mounted = false;
let session = 0;
let ended = true;
let inFlight: Promise<unknown> = Promise.resolve();
const live = () => {
  if (ended) throw new Error('This test has ended; its remaining steps are skipped.');
};
const advance = async (ms: number) => {
  live();
  const mine = session;
  const step = Promise.resolve(
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    }),
  );
  inFlight = step.catch(() => undefined);
  await step;
  if (mine !== session || ended) throw new Error('This test has ended; its remaining steps are skipped.');
};

const pageOf = (id: string, content: string) => ({
  id,
  kind: 'PAGE',
  title: id === 'page-1' ? 'Page' : 'Next',
  slug: id,
  path: `/${id}`,
  content,
  languageId: ENGLISH.id,
  parentId: null,
  position: id === 'page-1' ? 0 : 1,
  updatedAt: OPENED_AT,
});

const tree = () => (
  <Profiler
    id="editor-route"
    onRender={() => {
      work.commits += 1;
    }}
  >
    <EditorRoute />
  </Profiler>
);
/** Render the route again in place (a query answered, the comments changed). */
const rerender = () => act(async () => root.render(tree()));

async function open(content: string, others: Array<Record<string, unknown>> = []) {
  live();
  const page = pageOf('page-1', content);
  server = { content, updatedAt: OPENED_AT, patches: [] };
  mocks.page = page;
  mocks.pages = [page, ...others];
  mocks.languages = [ENGLISH];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
  await act(async () => root.render(tree()));
  await advance(50);
  if (!editor()) throw new Error('The editor did not mount');
}

const editor = () => {
  live();
  return (container.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapCore }) | null)?.editor;
};
const current = () => {
  const found = editor();
  if (!found) throw new Error('No editor');
  return found;
};

/** Insert `text` at the end of the paragraph starting with `start`, as a keystroke does. */
function typeAfter(start: string, text: string) {
  const ed = current();
  let end = -1;
  ed.state.doc.descendants((node, pos) => {
    if (end >= 0) return false;
    if (node.type.name === 'paragraph' && node.textContent.startsWith(start)) end = pos + node.nodeSize - 1;
    return end < 0;
  });
  if (end < 0) throw new Error(`No paragraph starts with ${start}`);
  ed.view.dispatch(ed.state.tr.insertText(text, end));
}
const FIRST_WORDS = 'Every paragraph';
const key = (text = 'x') => act(() => typeAfter(FIRST_WORDS, text));
/** `count` keystrokes, `every` ms apart (each typed, then the gap). */
async function typeSlowly(count: number, every: number) {
  for (let index = 0; index < count; index += 1) {
    key();
    await advance(every);
  }
}
/** The page as saved after `typed` was added to the end of its first paragraph
 *  (an edited paragraph is saved on one line; the others keep their breaks). */
const FIRST_PARAGRAPH =
  'Every paragraph on this page is wrapped by hand, the way most Markdown in a Git\nrepository is. Opening it must not change a byte.';
const withTyped = (typed: string) => HARD_WRAPPED_EN.replace(FIRST_PARAGRAPH, `${FIRST_PARAGRAPH.replaceAll('\n', ' ')}${typed}`);

/** Saves as [ms since `start`, characters typed], for comparing schedules. */
const saves = (start: number) => server.patches.map((patch) => [patch.at - start, (patch.content.match(/a byte\.(x*)/)?.[1] ?? '').length] as const);

beforeEach(() => {
  session += 1;
  ended = false;
  inFlight = Promise.resolve();
  mounted = false;
  mocks.page = undefined;
  mocks.pages = [];
  mocks.languages = [];
  mocks.comments = [];
  mocks.tree = null;
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
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, writable: true, value: () => [] });
  mocks.blocker = null;
  mocks.ai = null;
  mocks.update.mockReset();
  mocks.update.mockImplementation(
    async ({ pageId, body }: { pageId: string; body: { content: string; expectedUpdatedAt?: string; title: string } }) => {
      server.patches.push({ at: Date.now(), content: body.content, expectedUpdatedAt: body.expectedUpdatedAt });
      server = { ...server, content: body.content, updatedAt: new Date().toISOString() };
      const page = mocks.pages.find((item) => item.id === pageId) ?? mocks.page;
      return { ...page, title: body.title, content: body.content, updatedAt: server.updatedAt };
    },
  );
});

afterEach(async () => {
  ended = true;
  await inFlight;
  try {
    if (mounted) await act(async () => root.unmount());
  } finally {
    mounted = false;
    container?.remove();
    document.body.replaceChildren();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mocks.update.mockReset();
    mocks.blocker = null;
    mocks.ai = null;
  }
});

/*
 * Work per keystroke, on 18, 36 and 72 KB pages with three comments: node visits
 * (every `Fragment.nodesBetween` callback, which also counts `descendants`,
 * `textBetween` and `textContent`), Markdown serializer renders, characters
 * serialized, the route's unsupported-tag scan, and the listeners that ran. On
 * the code before the change each keystroke serialized the page, scanned it,
 * searched it once per comment, counted its words eight times and walked it four
 * times for code highlighting, so these grew with the page: 4× the page, 4× the
 * work. They must stay flat now. Counters, not timings: they do not depend on
 * the machine's load.
 */
const SECTIONS = [
  HARD_WRAPPED_EN,
  STARTER_GETTING_STARTED_CONTENT,
  STARTER_INSTALLATION_CONTENT,
  HARD_WRAPPED_AR,
  STARTER_COMPONENTS_TOUR_CONTENT,
  IMPORTED_INTRODUCTION,
  STARTER_API_CREATE_WIDGET_CONTENT,
  IMPORTED_QUICKSTART,
  STARTER_FAQ_CONTENT,
  '| Name | Value |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n',
];
const largePage = (bytes: number) => {
  let out = 'Every paragraph starts here: \n\n';
  for (let index = 0; out.length < bytes; index += 1) out += `${SECTIONS[index % SECTIONS.length]}\n\n`;
  return out;
};

const work = { nodeVisits: 0, serializerRenders: 0, serializedChars: 0, getMarkdown: 0, scans: 0, scannedChars: 0, counts: 0, commits: 0 };
const resetWork = () => {
  for (const name of Object.keys(work) as Array<keyof typeof work>) work[name] = 0;
  mocks.scan = { calls: 0, chars: 0 };
};
let depth = 0;
const nodesBetween = Fragment.prototype.nodesBetween;
const render = MarkdownSerializerState.prototype.render;
function instrumentPrototypes() {
  Fragment.prototype.nodesBetween = function (this: Fragment, from: number, to: number, f: never, nodeStart?: number, parent?: never) {
    if (depth > 0) return nodesBetween.call(this, from, to, f, nodeStart, parent);
    depth += 1;
    try {
      const counted = ((...args: unknown[]) => {
        work.nodeVisits += 1;
        return (f as (...a: unknown[]) => unknown)(...args);
      }) as never;
      return nodesBetween.call(this, from, to, counted, nodeStart, parent);
    } finally {
      depth -= 1;
    }
  } as never;
  MarkdownSerializerState.prototype.render = function (this: MarkdownSerializerState, ...args: Parameters<typeof render>) {
    work.serializerRenders += 1;
    return render.apply(this, args);
  };
}
function restorePrototypes() {
  Fragment.prototype.nodesBetween = nodesBetween;
  MarkdownSerializerState.prototype.render = render;
}
function instrumentEditor(ed: TiptapCore) {
  const storage = ed.storage as unknown as { markdown: { getMarkdown(): string }; characterCount: { words(): number; characters(): number } };
  const getMarkdown = storage.markdown.getMarkdown;
  storage.markdown.getMarkdown = () => {
    work.getMarkdown += 1;
    const out = getMarkdown();
    work.serializedChars += out.length;
    return out;
  };
  const { words, characters } = storage.characterCount;
  storage.characterCount.words = () => {
    work.counts += 1;
    return words();
  };
  storage.characterCount.characters = () => {
    work.counts += 1;
    return characters();
  };
}

const KEYS = 20;
type Row = { bytes: number } & Record<keyof typeof work, number>;
const rows: Row[] = [];
const pauses: Row[] = [];

describe('work per keystroke stays flat as the page grows (P2-ED-005)', { timeout: 180_000 }, () => {
  afterAll(() => {
    console.info(`[P2-ED-005 work per keystroke]\n${rows.map((row) => JSON.stringify(row)).join('\n')}`);
    console.info(`[P2-ED-005 work once per pause]\n${pauses.map((row) => JSON.stringify(row)).join('\n')}`);
  });

  it('18, 36 and 72 KB pages, three comments, 20 keystrokes each', async () => {
    mocks.comments = [
      { id: 'c1', resolved: false, anchor: { quote: 'regular' } },
      { id: 'c2', resolved: false, anchor: { quote: 'hard-wrapped' } },
      { id: 'c3', resolved: false, anchor: { quote: 'nowhere in the page at all' } },
    ];
    for (const bytes of [18_000, 36_000, 72_000]) {
      await open(largePage(bytes));
      await advance(1000);
      const ed = current();
      instrumentEditor(ed);
      const caret = (() => {
        let at = 0;
        ed.state.doc.descendants((node, pos) => {
          if (at) return false;
          if (node.isText && node.text?.startsWith('Every paragraph starts')) at = pos + node.text.length;
          return true;
        });
        return at;
      })();
      ed.commands.setTextSelection(caret);
      const type = (text: string) => {
        const { from, to } = ed.state.selection;
        const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, text, () => ed.state.tr.insertText(text, from, to)));
        if (!handled) ed.view.dispatch(ed.state.tr.insertText(text, from, to));
      };
      // Warm: the first keystroke after a save says "Saving" once.
      await act(async () => type('x'));
      instrumentPrototypes();
      try {
        resetWork();
        for (let index = 0; index < KEYS; index += 1) await act(async () => type('a'));
        work.scans = mocks.scan.calls;
        work.scannedChars = mocks.scan.chars;
        const row = { bytes } as Row;
        for (const [name, value] of Object.entries(work)) row[name as keyof typeof work] = value / KEYS;
        rows.push(row);
        // The pause after typing: serialized and scanned once, the comments found
        // once, and saved. Once per pause, not per keystroke (reported, not flat).
        resetWork();
        await advance(1000);
        work.scans = mocks.scan.calls;
        work.scannedChars = mocks.scan.chars;
        pauses.push({ bytes, ...work });
      } finally {
        restorePrototypes();
      }
      expect(server.patches.at(-1)?.content).toContain(`Every paragraph starts here:x${'a'.repeat(KEYS)}`);
      await act(async () => root.unmount());
      mounted = false;
      container.remove();
    }
    const [small, , large] = rows as [Row, Row, Row];
    // Nothing per keystroke reads the whole page.
    expect(large.serializerRenders).toBe(0);
    expect(large.serializedChars).toBe(0);
    expect(large.getMarkdown).toBe(0);
    expect(large.scannedChars).toBe(0);
    // At most the footer, whose counts change with each keystroke; never the route.
    expect(large.commits).toBeLessThanOrEqual(1);
    expect(large.commits).toBe(small.commits);
    // Flat: 4× the page, about the same work (the edited block is the same).
    expect(large.nodeVisits).toBeLessThanOrEqual(small.nodeVisits * 1.1 + 10);
    expect(large.counts).toBe(small.counts);
  });
});

describe('saves keep their moments and their content (P2-ED-005)', { timeout: ROUTE_TEST_TIMEOUT }, () => {
  it('idle: 5 keystrokes 100 ms apart, saved 0.7 s after the last, with all 5', async () => {
    await open(HARD_WRAPPED_EN);
    const start = Date.now();
    await typeSlowly(5, 100);
    await advance(20_000);
    expect(saves(start)).toEqual([[1100, 5]]);
    expect(server.content).toBe(withTyped('xxxxx'));
  });

  it('minimum interval: one character a second for 12 s, saved at 0.7, 3.7, 6.7, 9.7 and 12.7 s', async () => {
    await open(HARD_WRAPPED_EN);
    const start = Date.now();
    await typeSlowly(12, 1000);
    await advance(20_000);
    expect(saves(start)).toEqual([
      [700, 1],
      [3700, 4],
      [6700, 7],
      [9700, 10],
      [12_700, 12],
    ]);
    expect(server.content).toBe(withTyped('x'.repeat(12)));
  });

  it('maximum wait: a keystroke every 0.5 s for 25 s, saved at 10 s, 20 s and after it stops', async () => {
    await open(HARD_WRAPPED_EN);
    const start = Date.now();
    await typeSlowly(50, 500);
    await advance(20_000);
    expect(saves(start)).toEqual([
      [10_000, 20],
      [20_000, 40],
      [25_200, 50],
    ]);
  });

  it.each<[string, () => void]>([
    ['the window loses focus', () => window.dispatchEvent(new Event('blur'))],
    [
      'the tab is hidden',
      () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      },
    ],
    ['the page is closed (pagehide)', () => window.dispatchEvent(new Event('pagehide'))],
    ['the editor unmounts', () => root.unmount()],
  ])('%s, right after a keystroke: saved at once, with it', async (name, leave) => {
    await open(HARD_WRAPPED_EN);
    const start = Date.now();
    key();
    await advance(1000);
    key('x');
    // Inside the 3 s interval, and before the editor's pause: nothing serialized yet.
    await advance(10);
    await act(async () => leave());
    if (name === 'the editor unmounts') mounted = false;
    await advance(0);
    expect(saves(start)).toEqual([
      [700, 1],
      [1010, 2],
    ]);
    expect(server.content).toBe(withTyped('xx'));
    await advance(15_000);
    expect(server.patches).toHaveLength(2);
  });

  it('navigating away right after a keystroke: saved before the navigation, with it', async () => {
    await open(HARD_WRAPPED_EN);
    const start = Date.now();
    key();
    await advance(50);
    key();
    let blocked: boolean | undefined;
    await act(async () => {
      blocked = await mocks.blocker?.shouldBlockFn();
    });
    expect(blocked).toBe(false);
    expect(saves(start)).toEqual([[50, 2]]);
    await advance(15_000);
    expect(server.patches).toHaveLength(1);
  });

  it('opening another page right after a keystroke: the page is saved with it first', async () => {
    const next = pageOf('page-2', 'The next page.');
    await open(HARD_WRAPPED_EN, [next]);
    const start = Date.now();
    key();
    await advance(10);
    await act(async () => (mocks.tree as { onSelect: (id: string) => void } | null)?.onSelect('page-2'));
    await advance(0);
    expect(saves(start)).toEqual([[10, 1]]);
    expect(server.content).toBe(withTyped('x'));
    mocks.page = next;
    await advance(15_000);
    expect(server.patches).toHaveLength(1);
  });

  it('publishing right after a keystroke: saved before the publish, with it', async () => {
    await open(HARD_WRAPPED_EN);
    const start = Date.now();
    key();
    await advance(20);
    let ready: boolean | undefined;
    await act(async () => {
      ready = await mocks.publish?.beforePublish();
    });
    expect(ready).toBe(true);
    expect(saves(start)).toEqual([[20, 1]]);
    await advance(15_000);
    expect(server.patches).toHaveLength(1);
  });

  it('previewing right after a keystroke: saved before the preview opens, with it', async () => {
    const preview = { opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(preview as unknown as Window);
    await open(HARD_WRAPPED_EN);
    const start = Date.now();
    key();
    await advance(20);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="project.preview"]');
    if (!button) throw new Error('No Preview button');
    await act(async () => button.click());
    await advance(0);
    expect(saves(start)).toEqual([[20, 1]]);
    expect(preview.location.replace).toHaveBeenCalledOnce();
    await advance(15_000);
    expect(server.patches).toHaveLength(1);
  });

  it('the editor losing focus serializes at once: AI assist reads the text without waiting for the pause', async () => {
    await open(HARD_WRAPPED_EN);
    key('B');
    // Focus moves elsewhere (jsdom does not move focus off a contenteditable itself).
    await act(async () => current().view.dom.dispatchEvent(new FocusEvent('blur')));
    await advance(0);
    expect((mocks.ai as unknown as { content: string } | null)?.content).toBe(withTyped('B'));
    expect(server.patches).toEqual([]);
    await advance(1000);
    expect(server.patches.map((patch) => patch.content)).toEqual([withTyped('B')]);
  });

  it('edge (documented; differs from before): undo to the stored text, then type again before the editor serializes, keeps the first change time', async () => {
    await open(HARD_WRAPPED_EN);
    const start = Date.now();
    key('x');
    await advance(100);
    act(() => current().commands.undo());
    await advance(100);
    // Before, the undo made the draft clean and the next keystroke started a new
    // 10 s maximum wait (first save at 10.2 s). The undo is not serialized now
    // before the next keystroke, so the wait runs from the first change.
    await typeSlowly(24, 500);
    expect(saves(start)[0]?.[0]).toBe(10_000);
  });

  it('transactions that are not edits (selection, redraws, comment changes, focus) never save', async () => {
    mocks.comments = [{ id: 'c1', resolved: false, anchor: { quote: 'paragraph' } }];
    await open(HARD_WRAPPED_EN);
    const ed = current();
    act(() => ed.commands.setTextSelection(5));
    act(() => ed.view.dispatch(ed.state.tr.setMeta('addToHistory', false)));
    act(() => ed.commands.focus());
    mocks.comments = [{ id: 'c1', resolved: false, anchor: { quote: 'byte' } }];
    await rerender();
    await advance(1000);
    act(() => ed.commands.blur());
    await advance(1000);
    await act(async () => window.dispatchEvent(new Event('blur')));
    await act(async () => {
      await mocks.blocker?.shouldBlockFn();
    });
    await advance(15_000);
    expect(server.patches).toEqual([]);
  });

  it('undo back to the stored text: nothing saved, by any flush', async () => {
    await open(HARD_WRAPPED_EN);
    key('x');
    await advance(100);
    act(() => current().commands.undo());
    await advance(5000);
    await act(async () => window.dispatchEvent(new Event('blur')));
    await act(async () => {
      await mocks.blocker?.shouldBlockFn();
    });
    await act(async () => root.unmount());
    mounted = false;
    await advance(15_000);
    expect(server.patches).toEqual([]);
  });

  it('a fresher server copy arriving before the edit is serialized never re-seeds over it', async () => {
    await open(HARD_WRAPPED_EN);
    key('Q');
    const fresh = HARD_WRAPPED_EN.replace('Opening it must not change a byte.', 'Opening it must not change a byte. From elsewhere.');
    mocks.page = { ...mocks.page, content: fresh, updatedAt: '2026-11-14T10:00:00.000Z' };
    mocks.pages = [mocks.page];
    await rerender();
    await advance(0);
    expect(getMarkdown(current())).toContain('a byte.Q');
    expect(getMarkdown(current())).not.toContain('From elsewhere');
    await advance(5000);
    expect(server.patches.map((patch) => patch.content)).toEqual([withTyped('Q')]);
  });

  it('AI assist reads the current text once typing pauses', async () => {
    await open(HARD_WRAPPED_EN);
    key('Z');
    await advance(SERIALIZE_PAUSE);
    expect((mocks.ai as unknown as { content: string } | null)?.content).toBe(withTyped('Z'));
  });

  it('switching to the Markdown source right after a keystroke keeps it', async () => {
    await open(HARD_WRAPPED_EN);
    key('S');
    const source = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes('editor.editSource'));
    if (!source) throw new Error('No Edit source item');
    await act(async () => source.click());
    await advance(5000);
    expect(server.content).toBe(withTyped('S'));
  });

  it('turning the toolbar on right after a keystroke (the editor is rebuilt) keeps it', async () => {
    await open(HARD_WRAPPED_EN);
    key('T');
    const toggle = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((item) =>
      item.textContent?.includes('editor.showToolbar'),
    );
    if (!toggle) throw new Error('No toolbar item');
    await act(async () => toggle.click());
    await advance(5000);
    expect(server.content).toBe(withTyped('T'));
    expect(getMarkdown(current())).toBe(withTyped('T').trimEnd());
  });
});

/*
 * #728: undoing back to the stored text while an autosave is in flight. The
 * draft then compares clean with the stored copy, so no path saved it, and the
 * older write landed with the undone text. Whenever a write is pending and the
 * final draft differs from what it will store, the final draft is saved after it.
 */
type UpdateArgs = { pageId: string; body: { content: string; expectedUpdatedAt?: string; title: string } };
/** Writes held in flight, oldest first; `settleWrite` lands (or fails) the oldest. */
let held: Array<{ content: string; settle: (ok: boolean) => void }> = [];
const settleWrite = async (ok = true) => {
  const next = held.shift();
  if (!next) throw new Error('No write is in flight');
  await act(async () => next.settle(ok));
  await advance(0);
};
/** Land every write, letting the clock run between them, until none is left. */
async function drain() {
  for (let round = 0; round < 20; round += 1) {
    await advance(15_000);
    if (held.length === 0) return;
    await settleWrite();
  }
  throw new Error('The writes never settled');
}
/** Hold every write in flight until `settleWrite`; a failed one stores nothing. */
function holdWrites() {
  held = [];
  const land = mocks.update.getMockImplementation() as (args: UpdateArgs) => Promise<unknown>;
  mocks.update.mockImplementation(async (args: UpdateArgs) => {
    const ok = await new Promise<boolean>((settle) => held.push({ content: args.body.content, settle }));
    if (!ok) throw new Error('Network error');
    return land(args);
  });
}
const ORIGINAL = HARD_WRAPPED_EN;
const unmount = async () => {
  await act(async () => root.unmount());
  mounted = false;
};
const undo = () => act(() => current().commands.undo());
const redo = () => act(() => current().commands.redo());
const hideTab = () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  visibility.mockRestore();
};
/** Type `A` and let the autosave fire at 0.7 s: that write is now held in flight. */
async function typeAndHoldTheSave() {
  key('A');
  await advance(700);
  expect(held.map((write) => write.content)).toEqual([withTyped('A')]);
}

describe('#728: undo while an autosave is in flight', { timeout: ROUTE_TEST_TIMEOUT }, () => {
  beforeEach(holdWrites);

  it('regression: type, autosave in flight, undo, unmount at once, the write lands: the server holds the undone text', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    await unmount();
    await settleWrite();
    await drain();
    expect(server.content).toBe(ORIGINAL);
    expect(server.patches.map((patch) => patch.content)).toEqual([withTyped('A'), ORIGINAL]);
  });

  it('undo, then type again, then unmount: the new text is saved after the write', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    key('B');
    await unmount();
    await drain();
    expect(server.content).toBe(withTyped('B'));
  });

  it('staying on the page: the undone text is saved after the write lands', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    await advance(5000);
    await drain();
    expect(server.content).toBe(ORIGINAL);
  });

  it.each<[string, () => void]>([
    ['the window loses focus', () => window.dispatchEvent(new Event('blur'))],
    ['the tab is hidden', hideTab],
    ['the page is closed (pagehide)', () => window.dispatchEvent(new Event('pagehide'))],
  ])('%s after the undo: the undone text is sent as soon as the write lands, without waiting', async (_name, leave) => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    await act(async () => leave());
    await settleWrite();
    expect(held.map((write) => write.content)).toEqual([ORIGINAL]);
    await settleWrite();
    expect(server.content).toBe(ORIGINAL);
    await advance(15_000);
    expect(server.patches).toHaveLength(2);
  });

  it.each<[string, () => void]>([
    ['the tab is hidden', hideTab],
    ['the page is closed (pagehide)', () => window.dispatchEvent(new Event('pagehide'))],
  ])('%s after the undo is serialized, then the editor unmounts before the write lands: the undone text is saved', async (_name, leave) => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    await advance(SERIALIZE_PAUSE);
    await act(async () => leave());
    await unmount();
    await drain();
    expect(server.content).toBe(ORIGINAL);
  });

  it('navigating away after the undo: the navigation waits for the write and the undone text', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    let blocked: Promise<boolean> | undefined;
    await act(async () => {
      blocked = mocks.blocker?.shouldBlockFn();
    });
    await settleWrite();
    await settleWrite();
    expect(await blocked).toBe(false);
    expect(server.content).toBe(ORIGINAL);
    await unmount();
    await advance(15_000);
    expect(server.patches).toHaveLength(2);
  });

  it('opening another page after the undo: the page left is saved with the undone text first', async () => {
    const next = pageOf('page-2', 'The next page.');
    await open(ORIGINAL, [next]);
    await typeAndHoldTheSave();
    undo();
    await act(async () => (mocks.tree as { onSelect: (id: string) => void } | null)?.onSelect('page-2'));
    await settleWrite();
    await settleWrite();
    expect(server.content).toBe(ORIGINAL);
    mocks.page = next;
    await rerender();
    await drain();
    expect(server.patches).toHaveLength(2);
  });

  it.each<[string, () => Promise<unknown>]>([
    ['publishing', async () => expect(await mocks.publish?.beforePublish()).toBe(true)],
    [
      'previewing',
      async () => {
        const button = container.querySelector<HTMLButtonElement>('button[aria-label="project.preview"]');
        if (!button) throw new Error('No Preview button');
        button.click();
      },
    ],
  ])('%s after the undo: the undone text is saved first', async (_name, run) => {
    const preview = { opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(preview as unknown as Window);
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    let done: Promise<unknown> | undefined;
    await act(async () => {
      done = run();
    });
    await settleWrite();
    await settleWrite();
    await act(async () => done);
    expect(server.content).toBe(ORIGINAL);
    await advance(15_000);
    expect(server.patches).toHaveLength(2);
  });

  it('the write in flight fails, after an undo and new text, then unmount: the new text still reaches the server', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    key('B');
    await unmount();
    await settleWrite(false);
    await drain();
    expect(server.content).toBe(withTyped('B'));
  });

  it('the write in flight fails after the undo, then unmount: the server keeps the stored text', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    await unmount();
    await settleWrite(false);
    await drain();
    expect(server.content).toBe(ORIGINAL);
  });

  it('two quick undo/redo cycles ending on the undo, then unmount: the server holds the undone text', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    redo();
    undo();
    redo();
    undo();
    await unmount();
    await drain();
    expect(server.content).toBe(ORIGINAL);
  });

  it('two quick undo/redo cycles ending on the redo: the text is what the write stores, so nothing more is sent', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    redo();
    await advance(SERIALIZE_PAUSE);
    undo();
    redo();
    await act(async () => window.dispatchEvent(new Event('blur')));
    await unmount();
    await drain();
    expect(server.content).toBe(withTyped('A'));
    expect(server.patches).toHaveLength(1);
  });

  it.each<[string, () => Promise<void>]>([
    ['the editor unmounts', unmount],
    ['the window loses focus', async () => act(async () => window.dispatchEvent(new Event('blur')))],
    [
      'the author navigates away',
      async () => {
        await act(async () => {
          void mocks.blocker?.shouldBlockFn();
        });
      },
    ],
  ])('no undo, then %s: no second write of the same text', async (_name, leave) => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    await leave();
    await drain();
    expect(server.patches.map((patch) => patch.content)).toEqual([withTyped('A')]);
  });

  it('a newer server copy arrives during the write, after the undo, then unmount: the server holds the copy on screen', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    await advance(SERIALIZE_PAUSE);
    const fresh = ORIGINAL.replace('Opening it must not change a byte.', 'Opening it must not change a byte. From elsewhere.');
    mocks.page = { ...mocks.page, content: fresh, updatedAt: '2026-11-14T10:00:00.000Z' };
    mocks.pages = [mocks.page];
    await rerender();
    await advance(0);
    expect(getMarkdown(current())).toContain('From elsewhere.');
    await unmount();
    await drain();
    expect(server.content).toBe(fresh);
  });
});

/** A small seeded generator (mulberry32), so a failing sequence can be replayed. */
const seeded = (start: number) => {
  let seed = start;
  return () => {
    seed = (seed + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};
const SEEDS = Array.from({ length: 60 }, (_, index) => 728 + index * 7919);
const OPS = ['type', 'type', 'undo', 'undo', 'undo', 'redo', 'idle', 'idle', 'land', 'blur', 'hide'] as const;
const ENDINGS = ['unmount', 'pagehide', 'navigate', 'stay'] as const;

describe('#728 differential: once every write settles, the server holds the final draft', { timeout: 180_000 }, () => {
  beforeEach(holdWrites);

  // Writes leave one at a time (the save queue), so "completion order" is when
  // each lands among the edits and flushes: the `land` steps and the drain.
  it.each(SEEDS)('seed %i', async (seed) => {
    const random = seeded(seed);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    await open(ORIGINAL);
    const steps: string[] = [];
    for (let step = 0; step < 8; step += 1) {
      const op = pick(OPS);
      steps.push(op);
      if (op === 'type') key(pick(['a', 'b', 'c']));
      else if (op === 'undo') undo();
      else if (op === 'redo') redo();
      else if (op === 'idle') await advance(pick([50, SERIALIZE_PAUSE, 800, 800, 3500]));
      else if (op === 'land') {
        if (held.length > 0) await settleWrite();
      } else if (op === 'blur') await act(async () => window.dispatchEvent(new Event('blur')));
      else await act(async () => hideTab());
    }
    const ending = pick(ENDINGS);
    steps.push(ending);
    const finalDraft = getMarkdown(current()).trimEnd();
    let blocked: Promise<boolean> | undefined;
    if (ending === 'navigate') {
      await act(async () => {
        blocked = mocks.blocker?.shouldBlockFn();
      });
    } else if (ending === 'pagehide') {
      await act(async () => window.dispatchEvent(new Event('pagehide')));
      await unmount();
    } else if (ending === 'unmount') await unmount();
    await drain();
    if (blocked) expect(await blocked).toBe(false);
    expect({ steps, server: server.content.trimEnd() }).toEqual({ steps, server: finalDraft });
  });
});
