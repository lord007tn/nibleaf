// @vitest-environment jsdom
/**
 * P1-ED-001 and P2-JRN-001, end to end in the editor route: the real TipTap
 * editor, the real autosave (editor-save-throttle) and save queue, a mocked API
 * and fake timers.
 *
 * - Opening a page never saves it, whatever its Markdown looks like: the starter
 *   pages, hard-wrapped pages and imported pages.
 * - An edit saves the page with every paragraph the writer didn't touch exactly as
 *   it was, line breaks included, in English and Arabic.
 * - Typing saves at most every few seconds; leaving, losing focus or hiding the tab
 *   saves at once; a conflict still pauses saving.
 */

import { STARTER_PAGE_CONTENTS } from '@nibleaf/auth/starter-content';
import type { Editor as TiptapCore } from '@tiptap/core';
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/components/editor/sortable-page-tree', () => ({
  SortablePageTree: () => null,
  PageTreeDndProvider: ({ children }: { children: ReactNode }) => children,
  LanguageDropTarget: ({ children }: { children: ReactNode }) => children,
}));

import { Route } from './editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const EditorRoute = Route.options.component as ComponentType;

const ENGLISH = { id: 'lang-en', code: 'en', label: 'English', isDefault: true, direction: 'LTR' };
const ARABIC = { id: 'lang-ar', code: 'ar', label: 'العربية', isDefault: false, direction: 'RTL' };
const OPENED_AT = '2026-11-13T22:40:22.348Z';

/** The mocked API's copy of the page, and every PATCH it received. */
let server: { content: string; updatedAt: string; patches: Array<{ content: string; expectedUpdatedAt?: string }> };
let conflict = false;
let container: HTMLDivElement;
let root: Root;
let mounted = false;

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function open(content: string, language = ENGLISH) {
  const page = {
    id: 'page-1',
    kind: 'PAGE',
    title: 'Page',
    slug: 'page',
    path: '/page',
    content,
    languageId: language.id,
    parentId: null,
    position: 0,
    updatedAt: OPENED_AT,
  };
  server = { content, updatedAt: OPENED_AT, patches: [] };
  mocks.page = page;
  mocks.pages = [page];
  mocks.languages = [ENGLISH, ...(language === ENGLISH ? [] : [language])];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
  await act(async () => root.render(<EditorRoute />));
  // TipTap creates the editor on a timer and seeds it in a microtask.
  await advance(50);
  if (!editor()) throw new Error('The editor did not mount');
}

/** The page's TipTap editor (TipTap keeps it on the editable element). */
const editor = () => (container.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapCore }) | null)?.editor;

/** Type `text` at the end of the paragraph that starts with `start`, as keystrokes do. */
function typeAfter(start: string, text: string) {
  const current = editor();
  if (!current) throw new Error('No editor');
  let end = -1;
  current.state.doc.descendants((node, pos) => {
    if (end >= 0) return false;
    if (node.type.name === 'paragraph' && node.textContent.startsWith(start)) end = pos + node.nodeSize - 1;
    return end < 0;
  });
  if (end < 0) throw new Error(`No paragraph starts with ${start}`);
  current.view.dispatch(current.state.tr.insertText(text, end));
}

/** Replace the first `word` of the document with `replacement`, as a keystroke edit. */
function replaceWord(word: string, replacement: string) {
  const current = editor();
  if (!current) throw new Error('No editor');
  let from = -1;
  current.state.doc.descendants((node, pos) => {
    if (from >= 0) return false;
    const index = node.isText ? (node.text ?? '').indexOf(word) : -1;
    if (index >= 0) from = pos + index;
    return from < 0;
  });
  if (from < 0) throw new Error(`No ${word} in the page`);
  act(() => current.view.dispatch(current.state.tr.insertText(replacement, from, from + word.length)));
}

/** Keystrokes `every` ms apart for `count` characters, each typed then followed by the gap. */
async function typeSlowly(count: number, every: number) {
  for (let index = 0; index < count; index += 1) {
    act(() => typeAfter(FIRST_WORDS, 'x'));
    await advance(every);
  }
}
const FIRST_WORDS = 'Every paragraph';

/** Everything that can flush a pending save: idle past the maximum wait, the window
 *  losing focus, the tab hidden, navigation away, and unmounting. */
async function everyFlush() {
  await advance(15_000);
  await act(async () => window.dispatchEvent(new Event('blur')));
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  visibility.mockRestore();
  await act(async () => {
    await mocks.blocker?.shouldBlockFn();
  });
  await advance(1000);
  await act(async () => root.unmount());
  mounted = false;
  await advance(1000);
}

beforeEach(() => {
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
  // jsdom has no Web Animations; Base UI's scroll area asks for them on a timer.
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, writable: true, value: () => [] });
  conflict = false;
  mocks.blocker = null;
  mocks.refetched = undefined;
  mocks.ai = null;
  mocks.conflictDialog = null;
  mocks.history = null;
  mocks.update.mockReset();
  mocks.update.mockImplementation(async ({ body }: { body: { content: string; expectedUpdatedAt?: string; title: string } }) => {
    server.patches.push({ content: body.content, expectedUpdatedAt: body.expectedUpdatedAt });
    if (conflict) throw Object.assign(new Error('conflict'), { status: 409, code: 'page:revision_conflict' });
    server = { ...server, content: body.content, updatedAt: new Date().toISOString() };
    return { ...mocks.page, title: body.title, content: body.content, updatedAt: server.updatedAt };
  });
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  mounted = false;
  container?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('opening a page never saves it (P1-ED-001)', () => {
  it.each<[string, string, typeof ENGLISH]>([
    ...STARTER_PAGE_CONTENTS.map(({ title, content }): [string, string, typeof ENGLISH] => [`starter page "${title}"`, content, ENGLISH]),
    ['a hard-wrapped page', HARD_WRAPPED_EN, ENGLISH],
    ['a hard-wrapped Arabic page', HARD_WRAPPED_AR, ARABIC],
    ['the imported Introduction page', IMPORTED_INTRODUCTION, ENGLISH],
    ['the imported Quickstart page', IMPORTED_QUICKSTART, ENGLISH],
  ])('%s: 0 saves and the same updatedAt', async (_name, content, language) => {
    await open(content, language);
    await everyFlush();
    expect(server.patches).toEqual([]);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(server.updatedAt).toBe(OPENED_AT);
    expect(server.content).toBe(content);
  });
});

describe('an edit keeps every untouched paragraph as written', () => {
  it.each([
    ['English', HARD_WRAPPED_EN, ENGLISH, 'A short item.', 'A tiny item.'],
    ['Arabic', HARD_WRAPPED_AR, ARABIC, 'عنصر قصير.', 'عنصر صغير.'],
    ['the imported Introduction page', IMPORTED_INTRODUCTION, ENGLISH, 'perfect.', 'flawless.'],
  ])('%s: one word changed in a one-line paragraph', async (_name, source, language, word, replacement) => {
    await open(source, language);
    replaceWord(word, replacement);
    await advance(1000);
    expect(server.patches).toHaveLength(1);
    // Byte for byte: the edited word is the only difference.
    expect(server.content).toBe(source.replaceAll(word, replacement));
  });

  it.each([
    [
      'English',
      HARD_WRAPPED_EN,
      ENGLISH,
      'npm.',
      'pnpm.',
      'Install the package with your package manager of choice. The command below uses\nnpm.',
      'Install the package with your package manager of choice. The command below uses pnpm.',
    ],
    [
      'Arabic',
      HARD_WRAPPED_AR,
      ARABIC,
      'الحالتين',
      'كل الحالات',
      'لا. فاصل السطر الواحد داخل الفقرة يُقرأ كمسافة، فيرى القارئ فقرة واحدة في\nالحالتين.',
      'لا. فاصل السطر الواحد داخل الفقرة يُقرأ كمسافة، فيرى القارئ فقرة واحدة في كل الحالات.',
    ],
  ])('%s: a word changed in a wrapped paragraph re-wraps only that paragraph', async (_name, source, language, word, replacement, before, after) => {
    await open(source, language);
    replaceWord(word, replacement);
    await advance(1000);
    expect(server.patches).toHaveLength(1);
    expect(server.content).toBe(source.replaceAll(before, after));
  });

  it('typing a character and deleting it again leaves the page as it was', async () => {
    await open(HARD_WRAPPED_EN);
    act(() => typeAfter(FIRST_WORDS, 'x'));
    await advance(100);
    replaceWord('a byte.x', 'a byte.');
    await everyFlush();
    expect(server.patches).toEqual([]);
  });
});

describe('save pacing while typing (P2-JRN-001)', () => {
  it('one character a second for 12 s: 4 saves within the 12 s, 5 in all', async () => {
    await open(HARD_WRAPPED_EN);
    await typeSlowly(12, 1000);
    expect(server.patches).toHaveLength(4);
    await advance(15_000);
    expect(server.patches).toHaveLength(5);
    expect(server.content).toContain('a byte.xxxxxxxxxxxx');
  });

  it('a fast burst of 60 characters: 1 save, after the burst', async () => {
    await open(HARD_WRAPPED_EN);
    await typeSlowly(60, 50);
    expect(server.patches).toHaveLength(0);
    await advance(15_000);
    expect(server.patches).toHaveLength(1);
  });

  it('typing without a pause for 25 s: saved every 10 s, then after it stops (3)', async () => {
    await open(HARD_WRAPPED_EN);
    await typeSlowly(125, 200);
    expect(server.patches).toHaveLength(2);
    await advance(15_000);
    expect(server.patches).toHaveLength(3);
  });

  it('typing, then idle: 1 save, 0.7 s after the last keystroke', async () => {
    await open(HARD_WRAPPED_EN);
    await typeSlowly(5, 100);
    await advance(100);
    expect(server.patches).toHaveLength(0);
    await advance(600);
    expect(server.patches).toHaveLength(1);
    await advance(20_000);
    expect(server.patches).toHaveLength(1);
  });

  it('typing, then navigating away: saved before the navigation, 1 save', async () => {
    await open(HARD_WRAPPED_EN);
    await typeSlowly(3, 100);
    let blocked: boolean | undefined;
    await act(async () => {
      blocked = await mocks.blocker?.shouldBlockFn();
    });
    expect(blocked).toBe(false);
    expect(server.patches).toHaveLength(1);
    expect(server.content).toContain('xxx');
    await advance(15_000);
    expect(server.patches).toHaveLength(1);
  });

  it.each([
    ['the window loses focus', () => window.dispatchEvent(new Event('blur'))],
    [
      'the tab is hidden',
      () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      },
    ],
    ['the editor closes', () => root.unmount()],
  ])('typing, then %s: saved at once, 1 save', async (name, leave) => {
    await open(HARD_WRAPPED_EN);
    // Right after a save, a pending draft would otherwise wait out the 3 s interval.
    act(() => typeAfter(FIRST_WORDS, 'x'));
    await advance(1000);
    expect(server.patches).toHaveLength(1);
    act(() => typeAfter(FIRST_WORDS, 'y'));
    await act(async () => leave());
    if (name === 'the editor closes') mounted = false;
    await advance(0);
    expect(server.patches).toHaveLength(2);
    expect(server.content).toContain('xy');
    await advance(15_000);
    expect(server.patches).toHaveLength(2);
  });

  it('typing, then a conflict: 1 save attempt, "Saving paused", and no more attempts while typing goes on', async () => {
    conflict = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await open(HARD_WRAPPED_EN);
    await typeSlowly(3, 100);
    await advance(1000);
    expect(server.patches).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('editor.conflict.body');
    await typeSlowly(10, 1000);
    await advance(15_000);
    expect(server.patches).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('editor.conflict.body');
    expect(server.updatedAt).toBe(OPENED_AT);
  });
});

describe('undo never goes back past a re-seed (#630)', () => {
  const LATER = '2026-11-14T08:00:00.000Z';
  /** The page with its first paragraph changed, so each copy is recognisable. */
  const copy = (marker: string) => HARD_WRAPPED_EN.replaceAll('Opening it must not change a byte.', `Opening it must not change a byte. ${marker}`);
  const press = async (label: string) => {
    const button = [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find((item) => item.textContent?.includes(label));
    if (!button) throw new Error(`No ${label} button`);
    await act(async () => button.click());
    await advance(50);
  };

  /** Re-seed paths: each replaces the open page's content and returns the new content. */
  const paths: Array<[string, () => Promise<string>]> = [
    ['mount', async () => HARD_WRAPPED_EN],
    [
      'hydration refresh (a fresher server copy)',
      async () => {
        const fresh = copy('Fresh from the server.');
        mocks.page = { ...mocks.page, content: fresh, updatedAt: LATER };
        mocks.pages = [mocks.page];
        server = { ...server, content: fresh, updatedAt: LATER };
        await act(async () => root.render(<EditorRoute />));
        await advance(50);
        return fresh;
      },
    ],
    [
      'conflict merge ("Saving paused", then Review and merge)',
      async () => {
        conflict = true;
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        act(() => typeAfter(FIRST_WORDS, 'q'));
        await advance(1000);
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('editor.conflict.body');
        const theirs = copy('Edited by someone else.');
        mocks.refetched = { ...mocks.page, content: theirs, updatedAt: LATER };
        server = { ...server, content: theirs, updatedAt: LATER };
        await press('editor.conflict.review');
        const merged = copy('Edited by someone else. Merged with my edit.');
        conflict = false;
        await act(async () => mocks.conflictDialog?.onResolve({ title: 'Page', content: merged }));
        await advance(50);
        return merged;
      },
    ],
    [
      'restore from History',
      async () => {
        await press('editor.history.title');
        const restored = copy('Restored from history.');
        server = { ...server, content: restored, updatedAt: LATER };
        await act(async () => mocks.history?.onRestored({ ...mocks.page, content: restored, updatedAt: LATER }));
        await advance(50);
        return restored;
      },
    ],
    [
      'AI assist apply',
      async () => {
        const rewritten = copy('Rewritten by AI assist.');
        await act(async () => mocks.ai?.onContentChange(rewritten));
        await advance(50);
        return rewritten;
      },
    ],
  ];

  it.each(paths)('%s: type, undo ×10, and the page stays at the re-seeded content', async (_name, reseed) => {
    await open(HARD_WRAPPED_EN);
    // Some history from before the re-seed, as a writer who typed first would have.
    act(() => typeAfter(FIRST_WORDS, 'a'));
    await advance(100);
    act(() => editor()?.commands.undo());
    await advance(100);
    const reseeded = await reseed();
    const since = server.patches.length;
    // Saves the re-seed itself makes (an AI change or a merge is the writer's).
    await advance(5000);
    expect(getMarkdown(editor() as TiptapCore)).toBe(reseeded.trimEnd());
    act(() => typeAfter(FIRST_WORDS, 'y'));
    await advance(5000);
    const typed = server.content;
    for (let index = 0; index < 10; index += 1) {
      act(() => editor()?.commands.undo());
      await advance(100);
    }
    await advance(15_000);
    expect(getMarkdown(editor() as TiptapCore)).toBe(reseeded.trimEnd());
    // Only the re-seeded content and the writer's own edit since: never an older copy.
    for (const patch of server.patches.slice(since)) expect([reseeded, typed]).toContain(patch.content);
    expect(server.content).toBe(reseeded);
  });

  it('page switch: undo ×10 on the next page never reaches the previous one', async () => {
    await open(HARD_WRAPPED_EN);
    act(() => typeAfter(FIRST_WORDS, 'a'));
    await advance(5000);
    const next = { ...mocks.page, id: 'page-2', slug: 'next', path: '/next', title: 'Next', content: copy('The next page.'), updatedAt: LATER };
    mocks.page = next;
    mocks.pages = [next];
    server = { ...server, content: next.content, updatedAt: LATER };
    await act(async () => root.render(<EditorRoute />));
    await advance(50);
    const since = server.patches.length;
    expect(getMarkdown(editor() as TiptapCore)).toBe(next.content.trimEnd());
    act(() => typeAfter(FIRST_WORDS, 'y'));
    await advance(5000);
    const typed = server.content;
    for (let index = 0; index < 10; index += 1) {
      act(() => editor()?.commands.undo());
      await advance(100);
    }
    await advance(15_000);
    expect(getMarkdown(editor() as TiptapCore)).toBe(next.content.trimEnd());
    for (const patch of server.patches.slice(since)) expect([next.content, typed]).toContain(patch.content);
  });
});
