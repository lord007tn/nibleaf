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

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    [
      'the window loses focus',
      async () => {
        await act(async () => window.dispatchEvent(new Event('blur')));
      },
    ],
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

/*
 * #735: the compensating save after an undo was sent twice. The navigation's
 * flush queued the undone text against the stored revision; the `A` write then
 * landed, and the next flush (unmount, pagehide, a hidden tab, blur, or the
 * autosave's own timer) queued the same text again against the new revision.
 * The queue told them apart by revision only, so both were sent. Now a draft
 * whose text the last pending write already carries is sent only if that write
 * fails.
 */
/** Every write the route sent, landed or failed, as `original` or `original+<typed>`. */
let attempts: Array<{ pageId: string; content: string }> = [];
const label = (content: string) => (content === ORIGINAL ? 'original' : `original+${content.match(/a byte\.([^\n]*)/)?.[1] ?? '?'}`);
const sent = () => attempts.map((write) => label(write.content));
function recordAttempts() {
  attempts = [];
  const send = mocks.update.getMockImplementation() as (args: UpdateArgs) => Promise<unknown>;
  mocks.update.mockImplementation(async (args: UpdateArgs) => {
    attempts.push({ pageId: args.pageId, content: args.body.content });
    return send(args);
  });
}
/** Navigate away (the blocker's flush), returning whether the navigation was blocked. */
const navigate = async () => {
  let blocked: Promise<boolean> | undefined;
  await act(async () => {
    blocked = mocks.blocker?.shouldBlockFn();
  });
  return async () => expect(await blocked).toBe(false);
};
/** Publish (its flush), returning a check that the publish went ahead. */
const publish = async () => {
  let ready: Promise<boolean> | undefined;
  await act(async () => {
    ready = mocks.publish?.beforePublish();
  });
  return async () => expect(await ready).toBe(true);
};
const leaves: Array<[string, () => Promise<void>]> = [
  ['the editor unmounts', unmount],
  [
    'the page is closed (pagehide)',
    () =>
      act(async () => {
        window.dispatchEvent(new Event('pagehide'));
      }),
  ],
  ['the tab is hidden', () => act(async () => hideTab())],
  [
    'the window loses focus',
    () =>
      act(async () => {
        window.dispatchEvent(new Event('blur'));
      }),
  ],
  // Staying: the autosave's own timer flushes the draft while the write is held.
  ['the author stays on the page', () => advance(5000)],
];

describe('#735: one compensating save per final draft', { timeout: ROUTE_TEST_TIMEOUT }, () => {
  beforeEach(() => {
    holdWrites();
    recordAttempts();
  });

  it('regression: type, autosave in flight, undo, navigate, the write lands, unmount during the compensating save: it is sent once', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    const proceeded = await navigate();
    await settleWrite();
    expect(held.map((write) => label(write.content))).toEqual(['original']);
    await unmount();
    await drain();
    await proceeded();
    expect(sent()).toEqual(['original+A', 'original']);
    expect(server.content).toBe(ORIGINAL);
  });

  it.each(leaves)('navigating, then %s during the compensating save: sent once', async (_name, leave) => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    const proceeded = await navigate();
    await settleWrite();
    await leave();
    await drain();
    await proceeded();
    expect(sent()).toEqual(['original+A', 'original']);
    expect(server.content).toBe(ORIGINAL);
  });

  it.each(leaves)('publishing, then %s during the compensating save: sent once', async (_name, leave) => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    const published = await publish();
    await settleWrite();
    await leave();
    await drain();
    await published();
    expect(sent()).toEqual(['original+A', 'original']);
    expect(server.content).toBe(ORIGINAL);
  });

  it('two quick undo/redo cycles ending on the undo, then navigate and unmount: sent once', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    redo();
    undo();
    redo();
    undo();
    const proceeded = await navigate();
    await settleWrite();
    await unmount();
    await drain();
    await proceeded();
    expect(sent()).toEqual(['original+A', 'original']);
    expect(server.content).toBe(ORIGINAL);
  });

  it('the compensating save fails: the unmount flush sends the undone text again, and it lands', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    const proceeded = await navigate();
    await settleWrite();
    await unmount();
    await settleWrite(false);
    await drain();
    // The navigation's own save failed, so it stayed on the page and said so.
    await expect(proceeded()).rejects.toThrow();
    expect(sent()).toEqual(['original+A', 'original', 'original']);
    expect(server.content).toBe(ORIGINAL);
  });

  it('the write in flight fails: the undone text still lands, once', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    const proceeded = await navigate();
    await settleWrite(false);
    await unmount();
    await drain();
    await proceeded();
    expect(sent()).toEqual(['original+A', 'original']);
    expect(server.content).toBe(ORIGINAL);
  });

  it('a different final draft typed during the compensating save is never deduplicated', async () => {
    await open(ORIGINAL);
    await typeAndHoldTheSave();
    undo();
    const proceeded = await navigate();
    await settleWrite();
    key('B');
    await unmount();
    await drain();
    await proceeded();
    expect(sent()).toEqual(['original+A', 'original', 'original+B']);
    expect(server.content).toBe(withTyped('B'));
  });

  it('the same text on two pages: each page gets its own writes', async () => {
    const twin = { ...pageOf('page-2', ORIGINAL), title: 'Page' };
    await open(ORIGINAL, [twin]);
    await typeAndHoldTheSave();
    undo();
    await act(async () => (mocks.tree as { onSelect: (id: string) => void } | null)?.onSelect('page-2'));
    await settleWrite();
    await settleWrite();
    mocks.page = twin;
    await rerender();
    await advance(SERIALIZE_PAUSE);
    // The same edit on the twin: its autosave waits out the minimum interval.
    key('A');
    await advance(3500);
    expect(held.map((write) => label(write.content))).toEqual(['original+A']);
    undo();
    const proceeded = await navigate();
    await settleWrite();
    await unmount();
    await drain();
    await proceeded();
    expect(attempts.map((write) => `${write.pageId}:${label(write.content)}`)).toEqual([
      'page-1:original+A',
      'page-1:original',
      'page-2:original+A',
      'page-2:original',
    ]);
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
/**
 * Writes main (5eae6bf7) sent for each seed, from `__fixtures__/autosave-writes-main.json`
 * (#735). Made by running this file against main's save queue with
 * `WRITE_AUTOSAVE_WRITES_MAIN=1`.
 */
const WRITES_FIXTURE = resolve(import.meta.dirname, '../../../../components/editor/__fixtures__/autosave-writes-main.json');
const RECORDING_MAIN = Boolean(process.env.WRITE_AUTOSAVE_WRITES_MAIN);
const MAIN_WRITES: Record<number, number> = RECORDING_MAIN ? {} : JSON.parse(readFileSync(WRITES_FIXTURE, 'utf8')).writes;
const mainWrites: Record<number, number> = {};
afterAll(() => {
  if (RECORDING_MAIN)
    writeFileSync(
      WRITES_FIXTURE,
      `${JSON.stringify({ base: '5eae6bf7', writes: mainWrites }, null, 2)}
`,
    );
});
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
    // #735: never more writes than main sent for the same sequence.
    const writes = mocks.update.mock.calls.length;
    mainWrites[seed] = writes;
    expect({ steps, writes, main: MAIN_WRITES[seed], atMostMain: writes <= (MAIN_WRITES[seed] ?? (RECORDING_MAIN ? writes : -1)) }).toEqual({
      steps,
      writes,
      main: MAIN_WRITES[seed],
      atMostMain: true,
    });
  });
});

/*
 * #735 review: a repeat of a pending write's text is skipped only when that write
 * provably stored it. The draft's base must be the write's own or a revision this
 * queue produced (never a foreign server copy), and the response must show the
 * same page, title and content stored. Two losses the first version of the fix
 * had: retyping the text over another client's copy, and a write the server
 * stored normalized.
 */
/** How the server stores the write sent `index`-th (0-based): as sent, or normalized. */
let storeAs: (index: number, content: string) => string = (_index, content) => content;
/** Writes that the server stores when they are sent (`'request'`) or when their response lands (`'response'`). */
function serveWrites(commit: 'request' | 'response') {
  held = [];
  attempts = [];
  storeAs = (_index, content) => content;
  mocks.update.mockImplementation(async ({ pageId, body }: UpdateArgs) => {
    const index = attempts.length;
    attempts.push({ pageId, content: body.content });
    const store = () => {
      const content = storeAs(index, body.content);
      server.patches.push({ at: Date.now(), content, expectedUpdatedAt: body.expectedUpdatedAt });
      server = { ...server, content, updatedAt: new Date().toISOString() };
      const page = mocks.pages.find((item) => item.id === pageId) ?? mocks.page;
      return { ...page, title: body.title, content, updatedAt: server.updatedAt };
    };
    const early = commit === 'request' ? store() : undefined;
    const ok = await new Promise<boolean>((settle) => held.push({ content: body.content, settle }));
    if (!ok) throw new Error('Network error');
    return early ?? store();
  });
}
const NORMALIZED = '\n\nNormalized by the server.';
/** Another client saved `content` at `updatedAt`, and the route's page query returns it. */
async function foreignCopy(content: string, updatedAt: string) {
  server = { ...server, content, updatedAt };
  mocks.page = { ...mocks.page, content, updatedAt };
  mocks.pages = [mocks.page as Record<string, unknown>];
  await rerender();
  await advance(0);
}
/** Replace the last character of the first paragraph with `text`, as selecting it and typing does. */
function replaceLastTyped(text: string) {
  const ed = current();
  let end = -1;
  ed.state.doc.descendants((node, pos) => {
    if (end >= 0) return false;
    if (node.type.name === 'paragraph' && node.textContent.startsWith(FIRST_WORDS)) end = pos + node.nodeSize - 1;
    return end < 0;
  });
  ed.view.dispatch(ed.state.tr.insertText(text, end - 1, end));
}
const FOREIGN_AT = '2026-11-14T10:00:00.000Z';

describe('#735 review: a repeat is skipped only when the pending write stored it', { timeout: ROUTE_TEST_TIMEOUT }, () => {
  it('repro 1: the A write commits, undo, another client saves B, B is replaced by A, navigate, unmount: A is stored', async () => {
    await open(ORIGINAL);
    serveWrites('request');
    await typeAndHoldTheSave();
    undo();
    await foreignCopy(withTyped('B'), FOREIGN_AT);
    expect(getMarkdown(current())).toContain('a byte.B');
    act(() => replaceLastTyped('A'));
    const proceeded = await navigate();
    await unmount();
    await drain();
    await proceeded();
    expect(sent()).toEqual(['original+A', 'original+A']);
    expect(server.content).toBe(withTyped('A'));
  });

  it('the foreign copy is replaced by other text: that text is sent and stored', async () => {
    await open(ORIGINAL);
    serveWrites('request');
    await typeAndHoldTheSave();
    undo();
    await foreignCopy(withTyped('B'), FOREIGN_AT);
    act(() => replaceLastTyped('C'));
    const proceeded = await navigate();
    await unmount();
    await drain();
    await proceeded();
    expect(sent()).toEqual(['original+A', 'original+C']);
    expect(server.content).toBe(withTyped('C'));
  });

  it('the A write commits but its response fails, then the same retyping over the foreign copy: A is sent again and stored', async () => {
    await open(ORIGINAL);
    serveWrites('request');
    await typeAndHoldTheSave();
    undo();
    await foreignCopy(withTyped('B'), FOREIGN_AT);
    act(() => replaceLastTyped('A'));
    const proceeded = await navigate();
    await unmount();
    await settleWrite(false);
    await drain();
    await proceeded();
    expect(sent()).toEqual(['original+A', 'original+A']);
    expect(server.content).toBe(withTyped('A'));
  });

  it('repro 2: the #735 sequence, and the compensating write is stored normalized: the undone text is sent again and stored', async () => {
    await open(ORIGINAL);
    serveWrites('response');
    storeAs = (index, content) => (index === 1 ? `${content}${NORMALIZED}` : content);
    await typeAndHoldTheSave();
    undo();
    const proceeded = await navigate();
    await settleWrite();
    await unmount();
    await drain();
    await proceeded();
    expect(sent()).toEqual(['original+A', 'original', 'original']);
    expect(server.content).toBe(ORIGINAL);
  });

  it('the #735 sequence, and the A write is stored normalized: the compensating write stores the undone text, sent once', async () => {
    await open(ORIGINAL);
    serveWrites('response');
    storeAs = (index, content) => (index === 0 ? `${content}${NORMALIZED}` : content);
    await typeAndHoldTheSave();
    undo();
    const proceeded = await navigate();
    await settleWrite();
    await unmount();
    await drain();
    await proceeded();
    expect(sent()).toEqual(['original+A', 'original']);
    expect(server.content).toBe(ORIGINAL);
  });

  it('the #735 sequence, and the compensating write fails, then its replacement lands: the undone text is stored', async () => {
    await open(ORIGINAL);
    serveWrites('response');
    await typeAndHoldTheSave();
    undo();
    const proceeded = await navigate();
    await settleWrite();
    await unmount();
    await settleWrite(false);
    await drain();
    await expect(proceeded()).rejects.toThrow();
    expect(sent()).toEqual(['original+A', 'original', 'original']);
    expect(server.content).toBe(ORIGINAL);
  });
});

/*
 * The #728 generator with two more steps: another client's copy arriving (adopted
 * while the draft is clean, ignored while it is dirty) and the server storing the
 * next write normalized. Writes are stored when sent or when they land, per seed.
 * Whenever main ends with the final draft stored, this branch must too, and it
 * never sends more writes than main, except to store a final draft main lost.
 */
const REVIEW_SEEDS = Array.from({ length: 40 }, (_, index) => 735 + index * 6007);
const REVIEW_OPS = ['type', 'type', 'undo', 'undo', 'redo', 'idle', 'idle', 'land', 'blur', 'adopt', 'normalize'] as const;
const REVIEW_FIXTURE = resolve(import.meta.dirname, '../../../../components/editor/__fixtures__/autosave-review-main.json');
const RECORDING_REVIEW = Boolean(process.env.WRITE_AUTOSAVE_REVIEW_MAIN);
const MAIN_REVIEW: Record<number, { writes: number; stored: boolean }> = RECORDING_REVIEW
  ? {}
  : JSON.parse(readFileSync(REVIEW_FIXTURE, 'utf8')).seeds;
const reviewResults: Record<number, { writes: number; stored: boolean }> = {};
afterAll(() => {
  if (RECORDING_REVIEW) writeFileSync(REVIEW_FIXTURE, `${JSON.stringify({ base: '5eae6bf7', seeds: reviewResults }, null, 2)}\n`);
});

describe('#735 review differential: foreign copies and normalized writes', { timeout: 180_000 }, () => {
  it.each(REVIEW_SEEDS)('seed %i', async (seed) => {
    const random = seeded(seed);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    await open(ORIGINAL);
    serveWrites(random() < 0.5 ? 'request' : 'response');
    let normalizeFrom = Number.POSITIVE_INFINITY;
    storeAs = (index, content) => (index === normalizeFrom ? `${content}${NORMALIZED}` : content);
    let foreign = 0;
    const steps: string[] = [];
    for (let step = 0; step < 8; step += 1) {
      const op = pick(REVIEW_OPS);
      steps.push(op);
      if (op === 'type') key(pick(['a', 'b', 'c']));
      else if (op === 'undo') undo();
      else if (op === 'redo') redo();
      else if (op === 'idle') await advance(pick([50, SERIALIZE_PAUSE, 800, 800, 3500]));
      else if (op === 'land') {
        if (held.length > 0) await settleWrite();
      } else if (op === 'blur') await act(async () => window.dispatchEvent(new Event('blur')));
      else if (op === 'adopt') {
        foreign += 1;
        await foreignCopy(withTyped(`F${foreign}`), `2026-11-14T1${foreign}:00:00.000Z`);
      } else normalizeFrom = attempts.length;
    }
    const ending = pick(ENDINGS);
    steps.push(ending);
    const finalDraft = getMarkdown(current()).trimEnd();
    if (ending === 'navigate') {
      await act(async () => {
        void mocks.blocker?.shouldBlockFn();
      });
    } else if (ending === 'pagehide') {
      await act(async () => window.dispatchEvent(new Event('pagehide')));
      await unmount();
    } else if (ending === 'unmount') await unmount();
    await drain();
    const result = { writes: mocks.update.mock.calls.length, stored: server.content.trimEnd() === finalDraft };
    reviewResults[seed] = result;
    const main = MAIN_REVIEW[seed];
    if (RECORDING_REVIEW) return;
    // More writes than main only to store a final draft main lost (#757: a
    // normalized final draft is sent once more).
    const writes = result.writes <= (main?.writes ?? -1) || (main?.stored === false && result.stored);
    expect({ steps, main, writes, stored: result.stored || main?.stored === false }).toEqual({
      steps,
      main,
      writes: true,
      stored: true,
    });
  });
});

/*
 * #757: once every write settles, the server holds the author's final draft, or
 * the editor says it could not. Two ways main lost it without a word:
 *
 * - A write's response replaced the editor's server copy with the write's text,
 *   even after the editor had adopted a newer copy from another client while the
 *   write was in flight. The adopted copy was what the server held, but the
 *   editor took the older write's text for it: a final draft equal to that text
 *   looked saved, and was never sent.
 * - A write the server stored as other text (normalized) counted as the draft
 *   saved.
 *
 * Now a response only replaces the server copy the write was based on, and is
 * taken as what the server stored. A final draft stored as other text is sent
 * once more; if that is changed too, saving pauses for the conflict review.
 *
 * These tests use a server like the real one: every revision stamp is later than
 * the last (another client's too), and a write whose `expectedUpdatedAt` is not
 * the stored revision is refused with a revision conflict.
 */
/** Writes the server refused with a revision conflict. */
let refused = 0;
/** The next revision stamp, later than the stored one, as the server makes it. */
const nextStamp = () => new Date(Math.max(Date.now(), Date.parse(server.updatedAt) + 1)).toISOString();
/** Like `serveWrites`, with the real server's stamps and revision check. */
function serveLikeTheServer(commit: 'request' | 'response') {
  held = [];
  attempts = [];
  refused = 0;
  storeAs = (_index, content) => content;
  mocks.update.mockImplementation(async ({ pageId, body }: UpdateArgs) => {
    const index = attempts.length;
    attempts.push({ pageId, content: body.content });
    const store = () => {
      if (body.expectedUpdatedAt && body.expectedUpdatedAt !== server.updatedAt) {
        refused += 1;
        throw Object.assign(new Error('This page changed.'), { code: 'page:revision_conflict' });
      }
      const content = storeAs(index, body.content);
      server.patches.push({ at: Date.now(), content, expectedUpdatedAt: body.expectedUpdatedAt });
      server = { ...server, content, updatedAt: nextStamp() };
      const page = mocks.pages.find((item) => item.id === pageId) ?? mocks.page;
      return { ...page, title: body.title, content, updatedAt: server.updatedAt };
    };
    let early: Record<string, unknown> | undefined;
    let earlyError: unknown;
    if (commit === 'request') {
      try {
        early = store();
      } catch (error) {
        earlyError = error;
      }
    }
    const ok = await new Promise<boolean>((settle) => held.push({ content: body.content, settle }));
    if (!ok) throw new Error('Network error');
    if (earlyError) throw earlyError;
    return early ?? store();
  });
}
/** Another client saves `content` now, and the route's page query returns it. */
const foreignCopyNow = (content: string) => foreignCopy(content, nextStamp());
const conflictShown = () => mounted && (container.textContent ?? '').includes('editor.conflict.body');

describe("#757: after another client's copy is adopted, the final draft is stored", { timeout: ROUTE_TEST_TIMEOUT }, () => {
  it('repro 1: A commits (response held), undo, another client saves B, B is replaced by A, staying: A is stored', async () => {
    await open(ORIGINAL);
    serveLikeTheServer('request');
    await typeAndHoldTheSave();
    undo();
    await foreignCopyNow(withTyped('B'));
    expect(getMarkdown(current())).toContain('a byte.B');
    act(() => replaceLastTyped('A'));
    await settleWrite();
    await drain();
    // Main: ['original+A'], and the server ends with original+B.
    expect(sent()).toEqual(['original+A', 'original+A']);
    expect(server.content).toBe(withTyped('A'));
    expect(getMarkdown(current())).toBe(withTyped('A').trimEnd());
    expect(refused).toBe(0);
  });

  it.each(leaves)('repro 1, then %s before the response lands: A is stored', async (_name, leave) => {
    await open(ORIGINAL);
    serveLikeTheServer('request');
    await typeAndHoldTheSave();
    undo();
    await foreignCopyNow(withTyped('B'));
    act(() => replaceLastTyped('A'));
    await leave();
    await drain();
    expect(server.content).toBe(withTyped('A'));
    expect(refused).toBe(0);
  });

  it('repro 1, the response lands before B is replaced: the editor keeps showing B, and A is stored after it', async () => {
    await open(ORIGINAL);
    serveLikeTheServer('request');
    await typeAndHoldTheSave();
    undo();
    await foreignCopyNow(withTyped('B'));
    await settleWrite();
    expect(getMarkdown(current())).toContain('a byte.B');
    act(() => replaceLastTyped('A'));
    await drain();
    expect(sent()).toEqual(['original+A', 'original+A']);
    expect(server.content).toBe(withTyped('A'));
  });

  it('the adopted copy is not edited: it stays stored and on screen', async () => {
    await open(ORIGINAL);
    serveLikeTheServer('request');
    await typeAndHoldTheSave();
    undo();
    await foreignCopyNow(withTyped('B'));
    await settleWrite();
    await drain();
    expect(server.content).toBe(withTyped('B'));
    expect(getMarkdown(current())).toBe(withTyped('B').trimEnd());
  });
});

describe('#757: a write the server stores as other text', { timeout: ROUTE_TEST_TIMEOUT }, () => {
  it('repro 2: the final draft is stored normalized once: it is sent again, and stored as typed', async () => {
    await open(ORIGINAL);
    serveLikeTheServer('response');
    storeAs = (index, content) => (index === 0 ? `${content}${NORMALIZED}` : content);
    await typeAndHoldTheSave();
    await settleWrite();
    await drain();
    // Main: ['original+A'], and the server ends with the normalized text.
    expect(sent()).toEqual(['original+A', 'original+A']);
    expect(server.content).toBe(withTyped('A'));
    expect(conflictShown()).toBe(false);
  });

  it.each(leaves)('repro 2, then %s before the write lands: the final draft is sent again and stored', async (_name, leave) => {
    await open(ORIGINAL);
    serveLikeTheServer('response');
    storeAs = (index, content) => (index === 0 ? `${content}${NORMALIZED}` : content);
    await typeAndHoldTheSave();
    await leave();
    await drain();
    expect(sent()).toEqual(['original+A', 'original+A']);
    expect(server.content).toBe(withTyped('A'));
  });

  it('the server changes every write: sent twice, then saving pauses for the conflict review, with no more writes', async () => {
    await open(ORIGINAL);
    serveLikeTheServer('response');
    storeAs = (_index, content) => `${content}${NORMALIZED}`;
    await typeAndHoldTheSave();
    await drain();
    expect(sent()).toEqual(['original+A', 'original+A']);
    // Main: one write, "saved", and the server's text differs from the screen.
    expect(conflictShown()).toBe(true);
    expect(getMarkdown(current())).toBe(withTyped('A').trimEnd());
    await act(async () => window.dispatchEvent(new Event('blur')));
    await advance(30_000);
    expect(attempts).toHaveLength(2);
  });

  it('sending it again fails: the editor knows what the server stored, and saves the draft from that revision', async () => {
    await open(ORIGINAL);
    serveLikeTheServer('response');
    storeAs = (index, content) => (index === 0 ? `${content}${NORMALIZED}` : content);
    await typeAndHoldTheSave();
    await settleWrite();
    await settleWrite(false);
    await drain();
    expect(sent()).toEqual(['original+A', 'original+A', 'original+A']);
    expect(server.content).toBe(withTyped('A'));
    expect(refused).toBe(0);
  });

  it('a normalized write that is no longer the final draft is not sent again: the final draft is', async () => {
    await open(ORIGINAL);
    serveLikeTheServer('response');
    storeAs = (index, content) => (index === 0 ? `${content}${NORMALIZED}` : content);
    await typeAndHoldTheSave();
    key('B');
    await settleWrite();
    await drain();
    expect(sent()).toEqual(['original+A', 'original+AB']);
    expect(server.content).toBe(withTyped('AB'));
  });

  it('undoing to the text of a normalized write that was not sent again: it is saved', async () => {
    await open(ORIGINAL);
    serveLikeTheServer('response');
    storeAs = (index, content) => (index === 0 ? `${content}${NORMALIZED}` : content);
    await typeAndHoldTheSave();
    await advance(SERIALIZE_PAUSE);
    key('B');
    await settleWrite();
    undo();
    await drain();
    expect(server.content).toBe(withTyped('A'));
  });

  it('opening another page while the final draft is stored normalized: the page left is sent again and stored', async () => {
    const next = pageOf('page-2', 'The next page.');
    await open(ORIGINAL, [next]);
    serveLikeTheServer('response');
    storeAs = (index, content) => (index === 0 ? `${content}${NORMALIZED}` : content);
    await typeAndHoldTheSave();
    await act(async () => (mocks.tree as { onSelect: (id: string) => void } | null)?.onSelect('page-2'));
    mocks.page = next;
    await rerender();
    await drain();
    expect(attempts.map((write) => `${write.pageId}:${label(write.content)}`)).toEqual(['page-1:original+A', 'page-1:original+A']);
    expect(server.content).toBe(withTyped('A'));
  });
});

/*
 * The #728 generator with another client's copy arriving (adopted while the draft
 * is clean, ignored while it is dirty) and the server normalizing the next write,
 * against the real server's stamps and revision check; writes are stored when
 * sent or when they land, per seed. Once every write settles the server holds the
 * final draft, or a write was refused and the editor said so (a revision
 * conflict). Main's results are in `__fixtures__/autosave-adoption-main.json`;
 * this branch never sends more writes than main, except to store a final draft
 * main lost.
 */
const ADOPTION_OPS = [...OPS, 'adopt', 'normalize'] as const;
const ADOPTION_FIXTURE = resolve(import.meta.dirname, '../../../../components/editor/__fixtures__/autosave-adoption-main.json');
const RECORDING_ADOPTION = Boolean(process.env.WRITE_AUTOSAVE_ADOPTION_MAIN);
type AdoptionResult = { writes: number; stored: boolean; conflict: boolean };
const MAIN_ADOPTION: Record<number, AdoptionResult> = RECORDING_ADOPTION ? {} : JSON.parse(readFileSync(ADOPTION_FIXTURE, 'utf8')).seeds;
const adoptionResults: Record<number, AdoptionResult> = {};
afterAll(() => {
  if (RECORDING_ADOPTION) writeFileSync(ADOPTION_FIXTURE, `${JSON.stringify({ base: 'a716947c', seeds: adoptionResults }, null, 2)}\n`);
});

describe("#757 differential: adopted copies and normalized writes, against the real server's checks", { timeout: 180_000 }, () => {
  it.each(SEEDS)('seed %i', async (seed) => {
    const random = seeded(seed);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    await open(ORIGINAL);
    serveLikeTheServer(random() < 0.5 ? 'request' : 'response');
    let normalizeFrom = Number.POSITIVE_INFINITY;
    storeAs = (index, content) => (index === normalizeFrom ? `${content}${NORMALIZED}` : content);
    const foreignTexts = new Set<string>();
    let conflict = false;
    const steps: string[] = [];
    for (let step = 0; step < 8; step += 1) {
      const op = pick(ADOPTION_OPS);
      steps.push(op);
      if (op === 'type') key(pick(['a', 'b', 'c']));
      else if (op === 'undo') undo();
      else if (op === 'redo') redo();
      else if (op === 'idle') await advance(pick([50, SERIALIZE_PAUSE, 800, 800, 3500]));
      else if (op === 'land') {
        if (held.length > 0) await settleWrite();
      } else if (op === 'blur') await act(async () => window.dispatchEvent(new Event('blur')));
      else if (op === 'hide') await act(async () => hideTab());
      else if (op === 'adopt') {
        const text = withTyped(`F${foreignTexts.size + 1}`);
        foreignTexts.add(text.trimEnd());
        await foreignCopyNow(text);
      } else normalizeFrom = attempts.length;
      conflict ||= conflictShown();
    }
    const ending = pick(ENDINGS);
    steps.push(ending);
    let finalDraft = getMarkdown(current()).trimEnd();
    if (ending === 'navigate') {
      await act(async () => {
        void mocks.blocker?.shouldBlockFn().catch(() => undefined);
      });
    } else if (ending === 'pagehide') {
      await act(async () => window.dispatchEvent(new Event('pagehide')));
      await unmount();
    } else if (ending === 'unmount') await unmount();
    await drain();
    conflict ||= conflictShown() || refused > 0;
    // Still open, the editor may since have adopted a newer copy (only while the
    // draft had no unsaved change): what it shows is the final draft.
    if (mounted) finalDraft = getMarkdown(current()).trimEnd();
    const stored = server.content.trimEnd();
    // Left with no edit of the author's (undone back to a copy it loaded) while
    // the server holds another client's latest copy: nothing was the author's to save.
    const untouched = stored === [...foreignTexts].at(-1) && (finalDraft === ORIGINAL.trimEnd() || foreignTexts.has(finalDraft));
    const result: AdoptionResult = { writes: attempts.length, stored: stored === finalDraft || untouched, conflict };
    adoptionResults[seed] = result;
    if (RECORDING_ADOPTION) return;
    const main = MAIN_ADOPTION[seed];
    const mainLost = main !== undefined && !main.stored && !main.conflict;
    expect({
      steps,
      main,
      finalDraftOrConflict: result.stored || result.conflict,
      writes: result.writes <= (main?.writes ?? -1) || (mainLost && result.stored),
    }).toEqual({ steps, main, finalDraftOrConflict: true, writes: true });
  });
});
