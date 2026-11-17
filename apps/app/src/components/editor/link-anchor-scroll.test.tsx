/** @vitest-environment jsdom */
/**
 * #553: following a link to `page#section` in the editor opens the page and
 * lands on that heading, with the caret (and focus) at its start, as the
 * published site lands on it. An unknown section stays at the top, an in-page
 * `#section` link jumps within the page, Back and Forward keep working, a new
 * tab gets the section too, and reduced motion gets an instant jump. The
 * writer always wins (council): a landing still pending never moves the caret
 * or focus once the writer has acted, and an unknown section is looked up once.
 *
 * Animation frames are controlled here (`until` runs them), never slept on.
 * Each step waits for its real signal: the page's editor seeded, the reader's
 * headings looked up, the landing done, the frame queue quiet. The reader's
 * heading pass (the editor loads it lazily) is loaded with this file, so no
 * test waits on its transform, which under full-suite load can take seconds.
 */
// The reader's heading pass (mocked below with the real module) loads with the file, so the
// editor's lazy `import()` of it resolves at once instead of waiting on a transform under load.
import '@nibleaf/shared/reader-headings';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { EditorContent, useEditor } from '@tiptap/react';
import { act, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type EditorLinks, EditorLinksContext, editorLinkResolver } from './editor-links';
import { editorIn } from './editor-sections';
import { type LinkedPages, useLinkedPageHistory } from './linked-page-history';
import { buildEditorExtensions, seedMarkdown } from './tiptap-editor';

// The reader's real heading pass, counting its calls: a call is the landing looking its section up.
const lookups = vi.hoisted(() => ({ count: 0 }));
vi.mock('@nibleaf/shared/reader-headings', async (importOriginal) => {
  const real = await importOriginal<typeof import('@nibleaf/shared/reader-headings')>();
  return {
    ...real,
    readerHeadings: (content: string) => {
      lookups.count += 1;
      return real.readerHeadings(content);
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGES: Record<string, string> = {
  'page-a': ['# Overview', 'Read [the usage notes](#usage) first.', '## Details', 'Text.', '## Usage', 'How to use it.'].join('\n\n'),
  'page-b': [
    '## Before you start',
    'Text.',
    '## Install',
    'Run the installer.',
    '## Setup',
    'The first setup.',
    '## Setup',
    'The second setup.',
    '## تثبيت الأداة',
    'نص.',
  ].join('\n\n'),
};

const harness: { pages?: LinkedPages; editable: boolean; deferSeed: boolean; editors: Map<string, import('@tiptap/core').Editor> } = {
  editable: true,
  deferSeed: false,
  editors: new Map(),
};

const rootRoute = createRootRoute({ component: Outlet });
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/projects/$projectId/editor',
  validateSearch: (search: Record<string, unknown>) => ({ page: typeof search.page === 'string' ? search.page : undefined }),
  component: EditorScreen,
});

/** One page in the real editor, created with its content and then seeded from Markdown, as the page editor does it. */
function PageEditor({ pageId, links }: { pageId: string; links: EditorLinks }) {
  const linksRef = useRef(links);
  linksRef.current = links;
  const editor = useEditor({
    editable: harness.editable,
    extensions: buildEditorExtensions({ getLinks: () => linksRef.current }),
    // The headings are there before the seed, which then replaces the document and moves the caret.
    content: PAGES[pageId] ?? '',
    onCreate: ({ editor: created }) => {
      const seed = () => !created.isDestroyed && seedMarkdown(created, PAGES[pageId] ?? '');
      // `deferSeed`: the seed waits for a frame, so the writer can act before it.
      if (harness.deferSeed) requestAnimationFrame(seed);
      else queueMicrotask(seed);
    },
  });
  useEffect(() => {
    if (editor) harness.editors.set(pageId, editor);
  }, [editor, pageId]);
  return <EditorContent editor={editor} />;
}

/** The page editor in miniature: it opens on page A, and selects the page `?page=` names, as the route does. */
function EditorScreen() {
  const { page } = editorRoute.useSearch();
  const [selected, setSelected] = useState(page ?? 'page-a');
  useEffect(() => {
    if (page) setSelected(page);
  }, [page]);
  const canvas = useRef<HTMLDivElement>(null);
  const pages = useLinkedPageHistory({ projectId: 'project-1', pageId: selected, canvas: () => canvas.current });
  harness.pages = pages;
  const links = useMemo<EditorLinks>(
    () => ({
      resolve: editorLinkResolver(null, selected),
      open: (id, section) => void pages.open(id, section),
      href: pages.href,
      resolveAsync: async (href) => editorLinkResolver(null, selected)(href),
      loadVersions: () => undefined,
    }),
    [pages, selected],
  );
  return (
    <EditorLinksContext.Provider value={links}>
      <div ref={canvas} data-testid="canvas" data-page={selected}>
        <PageEditor key={selected} pageId={selected} links={links} />
      </div>
    </EditorLinksContext.Provider>
  );
}

const roots: Array<ReturnType<typeof createRoot>> = [];
let scrolled: Array<{ element: Element; options: ScrollIntoViewOptions | boolean | undefined }>;
let reducedMotion: boolean;
/** Animation frames requested and not run yet. */
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
/** Animation frames requested in this test. */
let requestedFrames = 0;

beforeEach(() => {
  frames.clear();
  requestedFrames = 0;
  lookups.count = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    requestedFrames += 1;
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  harness.deferSeed = false;
  harness.editable = true;
  harness.editors.clear();
  scrolled = [];
  reducedMotion = false;
  // jsdom has no layout: record where the editor asks to scroll.
  Element.prototype.scrollIntoView = function (this: Element, options?: ScrollIntoViewOptions | boolean) {
    scrolled.push({ element: this, options });
  };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion: reduce') && reducedMotion,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  Object.assign(document, { elementFromPoint: () => null });
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

/** Run one animation frame: the callbacks requested before it. */
const runFrame = () => {
  const due = [...frames];
  frames.clear();
  for (const [, callback] of due) callback(performance.now());
};
/** How long one step may take to reach its signal: well over what a step takes, under load included, and inside the test's own 5 s. */
const STEP_BOUND_MS = 4000;
/**
 * Wait until `ready()`: each round runs the due animation frames (unless
 * `runFrames` is false, for a step that must happen before the next frame), then
 * lets React, promises and timers settle, and checks again.
 */
const until = (ready: () => boolean, what: string, { runFrames = true } = {}) =>
  vi.waitFor(
    async () => {
      await act(async () => {
        if (runFrames) runFrame();
        await new Promise((done) => setTimeout(done, 0));
      });
      if (!ready()) throw new Error(`Still waiting for ${what}`);
    },
    { timeout: STEP_BOUND_MS, interval: 1 },
  );

/** The canvas shows `pageId` in an editor that holds its content (seeded). */
const shows = (pageId: string) => {
  const canvas = document.querySelector<HTMLDivElement>('[data-testid="canvas"]');
  return canvas?.dataset.page === pageId && harness.editors.has(pageId) && editorIn(canvas) === harness.editors.get(pageId);
};
/** Nothing is waiting for a frame. */
const quiet = () => frames.size === 0;
/** The landing has looked its section up (the reader's headings were read since `before`), and nothing waits for a frame. */
const lookedUp = (before: number) => lookups.count > before && quiet();

/** The writer types `text` at the caret: the key and input events, then the edit. */
const type = (editor: import('@tiptap/core').Editor, text: string) =>
  act(async () => {
    for (const character of text) {
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: character, bubbles: true, cancelable: true }));
      editor.view.dom.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: character, bubbles: true, cancelable: true }));
      editor.commands.insertContent(character);
    }
  });
/** The end of the heading with this text, as a document position. */
const headingEnd = (editor: import('@tiptap/core').Editor, text: string) => {
  let end = -1;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'heading' && node.textContent === text) end = position + 1 + node.content.size;
    return end < 0;
  });
  return end;
};

async function renderEditor(start = '/app/projects/project-1/editor') {
  const history = createMemoryHistory({ initialEntries: [start] });
  const router = createRouter({ routeTree: rootRoute.addChildren([editorRoute]), history });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<RouterProvider router={router} />));
  await act(async () => router.load());
  const first = new URL(start, 'https://app.invalid').searchParams.get('page') ?? 'page-a';
  await until(() => shows(first), `the editor to show ${first}`);
  const canvas = () => container.querySelector<HTMLDivElement>('[data-testid="canvas"]') as HTMLDivElement;
  const scroll = async (top: number) => {
    canvas().scrollTop = top;
    await act(async () => canvas().dispatchEvent(new Event('scroll')));
  };
  const editor = () => {
    const current = harness.editors.get(canvas().dataset.page ?? '');
    if (!current) throw new Error('No editor on screen');
    return current;
  };
  return { history, router, canvas, scroll, editor };
}

/** The heading the editor shows with this text (the `nth` one, for repeated text). */
const heading = (canvas: HTMLElement, text: string, nth = 0) => {
  const found = [...canvas.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((element) => element.textContent === text)[nth];
  if (!found) throw new Error(`No heading "${text}"`);
  return found as HTMLElement;
};

/** The text of the block the caret is in, and whether it sits at the block's start. */
const caret = (editor: import('@tiptap/core').Editor) => {
  const { $from, empty } = editor.state.selection;
  return { block: $from.parent.textContent, type: $from.parent.type.name, atStart: empty && $from.parentOffset === 0 };
};

describe('following a link to a section of another page (#553)', () => {
  it('opens the page, scrolls to the matching heading and puts the caret, with focus, at its start', async () => {
    const { router, canvas, editor } = await renderEditor();
    await act(async () => harness.pages?.open('page-b', 'install'));
    await until(() => shows('page-b') && scrolled.length > 0, 'the landing on page B');
    expect(router.state.location.search).toEqual({ page: 'page-b' });
    expect(router.state.location.hash).toBe('install');
    expect(canvas().dataset.page).toBe('page-b');
    const target = heading(canvas(), 'Install');
    expect(scrolled.at(-1)?.element).toBe(target);
    expect(scrolled.at(-1)?.options).toMatchObject({ block: 'start', behavior: 'smooth' });
    expect(caret(editor())).toEqual({ block: 'Install', type: 'heading', atStart: true });
    expect(editor().view.dom.contains(document.activeElement) || document.activeElement === editor().view.dom).toBe(true);
  });

  it('a repeated heading is found by the reader’s suffix', async () => {
    const { canvas, editor } = await renderEditor();
    await act(async () => harness.pages?.open('page-b', 'setup-1'));
    await until(() => shows('page-b') && scrolled.length > 0, 'the landing on page B');
    expect(scrolled.at(-1)?.element).toBe(heading(canvas(), 'Setup', 1));
    expect(caret(editor()).block).toBe('Setup');
    // The second "Setup": the caret is in the heading after "The first setup."
    const { $from } = editor().state.selection;
    expect(editor().state.doc.textBetween(0, $from.pos, '\n')).toContain('The first setup.');
  });

  it('finds an Arabic heading from an encoded or a plain fragment', async () => {
    const { canvas } = await renderEditor();
    await act(async () => harness.pages?.open('page-b', 'تثبيت-الأداة'));
    await until(() => shows('page-b') && scrolled.length > 0, 'the landing on page B');
    expect(scrolled.at(-1)?.element).toBe(heading(canvas(), 'تثبيت الأداة'));
  });

  it('an unknown section stays at the top, with no error', async () => {
    const errors = vi.spyOn(console, 'error');
    const { router, canvas, scroll, editor } = await renderEditor();
    await scroll(300);
    const before = lookups.count;
    await act(async () => harness.pages?.open('page-b', 'no-such-section'));
    await until(() => shows('page-b') && lookedUp(before), 'page B and its section looked up');
    expect(router.state.location.search).toEqual({ page: 'page-b' });
    expect(canvas().dataset.page).toBe('page-b');
    expect(scrolled).toEqual([]);
    expect(canvas().scrollTop).toBe(0);
    expect(caret(editor()).block).not.toBe('Install');
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('a page reached by a link with no section opens at its top, as before', async () => {
    const { canvas, scroll } = await renderEditor();
    await scroll(300);
    await act(async () => harness.pages?.open('page-b'));
    await until(() => shows('page-b') && quiet(), 'page B');
    expect(scrolled).toEqual([]);
    expect(canvas().scrollTop).toBe(0);
  });

  it('reduced motion gets an instant jump', async () => {
    reducedMotion = true;
    const { canvas } = await renderEditor();
    await act(async () => harness.pages?.open('page-b', 'install'));
    await until(() => shows('page-b') && scrolled.length > 0, 'the landing on page B');
    expect(scrolled.at(-1)?.element).toBe(heading(canvas(), 'Install'));
    expect(scrolled.at(-1)?.options).toMatchObject({ block: 'start', behavior: 'auto' });
  });

  it('a read-only page puts focus on the heading itself', async () => {
    harness.editable = false;
    const { canvas } = await renderEditor();
    await act(async () => harness.pages?.open('page-b', 'install'));
    await until(() => shows('page-b') && scrolled.length > 0, 'the landing on page B');
    const target = heading(canvas(), 'Install');
    expect(scrolled.at(-1)?.element).toBe(target);
    expect(document.activeElement).toBe(target);
  });
});

describe('a #section link on the page being read (#553)', () => {
  it('jumps to the heading within the page, in its own history entry', async () => {
    harness.editable = false;
    const { history, router, canvas, editor } = await renderEditor();
    const start = history.length;
    const link = canvas().querySelector<HTMLAnchorElement>('a[href="#usage"]');
    if (!link) throw new Error('No #usage link');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 0 });
    await act(async () => link.dispatchEvent(event));
    await until(() => scrolled.length > 0, 'the landing on Usage');
    expect(event.defaultPrevented).toBe(true);
    expect(router.state.location.search).toEqual({ page: 'page-a' });
    expect(router.state.location.hash).toBe('usage');
    expect(history.length).toBe(start + 1);
    // The same editor: the page was not reloaded.
    expect(harness.editors.size).toBe(1);
    expect(scrolled.at(-1)?.element).toBe(heading(canvas(), 'Usage'));
    expect(document.activeElement).toBe(heading(canvas(), 'Usage'));
    expect(editor().isEditable).toBe(false);
  });

  it('jumps within the page from the editing view too', async () => {
    const { router, canvas, editor } = await renderEditor();
    await act(async () => harness.pages?.open('page-a', 'details'));
    await until(() => scrolled.length > 0, 'the landing on Details');
    expect(router.state.location.hash).toBe('details');
    expect(scrolled.at(-1)?.element).toBe(heading(canvas(), 'Details'));
    expect(caret(editor())).toEqual({ block: 'Details', type: 'heading', atStart: true });
  });
});

describe('Back and Forward around a section link (#553)', () => {
  it('Back returns to the page the link was followed from, where it was; Forward returns to the section', async () => {
    const { history, router, canvas, scroll } = await renderEditor();
    await scroll(420);
    await act(async () => harness.pages?.open('page-b', 'install'));
    await until(() => shows('page-b') && scrolled.length > 0, 'the landing on page B');
    expect(router.state.location.hash).toBe('install');
    // Where the jump left the page.
    await scroll(640);

    await act(async () => history.back());
    await until(() => shows('page-a') && quiet(), 'page A again');
    expect(router.state.location.search).toEqual({ page: 'page-a' });
    expect(router.state.location.hash).toBe('');
    expect(canvas().dataset.page).toBe('page-a');
    expect(canvas().scrollTop).toBe(420);

    await act(async () => history.forward());
    await until(() => shows('page-b') && quiet(), 'page B again');
    expect(router.state.location.search).toEqual({ page: 'page-b' });
    expect(router.state.location.hash).toBe('install');
    expect(canvas().dataset.page).toBe('page-b');
    expect(canvas().scrollTop).toBe(640);
  });

  it('Back after an in-page jump returns to where the page was', async () => {
    const { history, router, canvas, scroll } = await renderEditor();
    await scroll(120);
    await act(async () => harness.pages?.open('page-a', 'usage'));
    await until(() => scrolled.length > 0, 'the landing on Usage');
    await scroll(500);
    await act(async () => history.back());
    await until(() => router.state.location.hash === '' && quiet(), 'the entry before the jump');
    expect(router.state.location.hash).toBe('');
    expect(canvas().scrollTop).toBe(120);
  });

  it('an editor opened at page#section (a new tab, a reload) lands on the section', async () => {
    const { canvas } = await renderEditor('/app/projects/project-1/editor?page=page-b#setup-1');
    await until(() => scrolled.length > 0, 'the landing on the second Setup');
    expect(canvas().dataset.page).toBe('page-b');
    expect(scrolled.at(-1)?.element).toBe(heading(canvas(), 'Setup', 1));
  });
});

describe('the writer always wins over a pending landing (#553 council)', () => {
  it('an unknown #detailsx, then a click on Details and typing xY, gives DetailsxY with the caret kept', async () => {
    const { canvas, editor } = await renderEditor();
    const before = lookups.count;
    await act(async () => harness.pages?.open('page-a', 'detailsx'));
    await until(() => lookedUp(before), 'the section looked up');
    expect(scrolled).toEqual([]);
    await act(async () => heading(canvas(), 'Details').dispatchEvent(new Event('pointerdown', { bubbles: true })));
    const end = headingEnd(editor(), 'Details');
    await act(async () => editor().commands.setTextSelection(end));
    await type(editor(), 'x');
    // The renamed heading now reads "Detailsx": a landing still looking would find it here.
    await until(quiet, 'no frame pending');
    await type(editor(), 'Y');
    await until(quiet, 'no frame pending');
    expect(heading(canvas(), 'DetailsxY')).toBeTruthy();
    expect(caret(editor())).toEqual({ block: 'DetailsxY', type: 'heading', atStart: false });
    expect(editor().state.selection.from).toBe(end + 2);
    expect(scrolled).toEqual([]);
  });

  it('typing during a deferred seed keeps its position', async () => {
    harness.deferSeed = true;
    const { editor } = await renderEditor();
    await act(async () => harness.pages?.open('page-b', 'install'));
    // Page B is on screen, its seed not run yet (no frame has run): the writer starts typing.
    await until(() => harness.editors.has('page-b') && !shows('page-b'), 'page B before its seed', { runFrames: false });
    await type(editor(), 'z');
    await until(() => shows('page-b'), 'the seed of page B');
    const after = editor().state.selection.from;
    await until(quiet, 'no frame pending');
    expect(editor().state.selection.from).toBe(after);
    expect(caret(editor()).block).not.toBe('Install');
    expect(scrolled).toEqual([]);
  });

  it('a field focused before the landing frame keeps focus', async () => {
    harness.deferSeed = true;
    const { editor } = await renderEditor();
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Page title');
    document.body.append(field);
    await act(async () => harness.pages?.open('page-b', 'install'));
    field.focus();
    await until(() => shows('page-b') && quiet(), 'page B, seeded');
    expect(document.activeElement).toBe(field);
    expect(caret(editor()).block).not.toBe('Install');
    expect(scrolled).toEqual([]);
  });

  it('an unknown section is looked up once, after the seed, and requests no further frames', async () => {
    harness.deferSeed = true;
    await renderEditor();
    const before = lookups.count;
    await act(async () => harness.pages?.open('page-b', 'no-such-section'));
    await until(() => shows('page-b') && lookups.count > before, 'the section looked up');
    // Looked up: nothing waits for a frame now, and nothing asks for one later.
    expect(frames.size).toBe(0);
    const requested = requestedFrames;
    await until(quiet, 'no frame pending');
    expect(requestedFrames).toBe(requested);
    expect(scrolled).toEqual([]);
  });
});

describe('Back and Forward after a publish check’s Fix rewrote the address (P1-ED-002)', () => {
  const PAGE_A = '/app/projects/project-1/editor?page=page-a';
  /** What the editor route does once a Fix has landed: drop its parameters with a replace that keeps the page in place. */
  const dropFix = (router: Awaited<ReturnType<typeof renderEditor>>['router']) =>
    act(async () => {
      await router.navigate({
        to: '/app/projects/$projectId/editor',
        params: { projectId: 'project-1' },
        search: { page: 'page-a' },
        hash: true,
        replace: true,
        state: (previous) => ({ ...previous, editorKeepScroll: true }),
      });
    });

  it('the rewrite itself leaves the page where the Fix put it', async () => {
    const { router, canvas, scroll } = await renderEditor(PAGE_A);
    await scroll(300);
    await dropFix(router);
    await until(quiet, 'the rewrite settled');
    expect(canvas().scrollTop).toBe(300);
  });

  it('Back after a same-page section link returns to where the page was, not where the section left it', async () => {
    const { history, router, canvas, scroll } = await renderEditor(PAGE_A);
    await dropFix(router);
    await until(quiet, 'the rewrite settled');
    await scroll(420);
    await act(async () => harness.pages?.open('page-a', 'usage'));
    await until(() => router.state.location.hash === 'usage' && scrolled.length > 0, 'the landing on Usage');
    await scroll(1500);
    await act(async () => history.back());
    await until(() => router.state.location.hash === '' && quiet(), 'the entry before the jump');
    expect(canvas().scrollTop).toBe(420);
    await act(async () => history.forward());
    await until(() => router.state.location.hash === 'usage' && quiet(), 'the section again');
    expect(canvas().scrollTop).toBe(1500);
  });

  it('Back and Forward across pages after a Fix restore each page', async () => {
    const { history, router, canvas, scroll } = await renderEditor(PAGE_A);
    await dropFix(router);
    await until(quiet, 'the rewrite settled');
    await scroll(420);
    await act(async () => harness.pages?.open('page-b', 'install'));
    await until(() => shows('page-b') && scrolled.length > 0, 'the landing on page B');
    await scroll(640);
    await act(async () => history.back());
    await until(() => shows('page-a') && quiet(), 'page A again');
    expect(canvas().scrollTop).toBe(420);
    await act(async () => history.forward());
    await until(() => shows('page-b') && quiet(), 'page B again');
    expect(canvas().scrollTop).toBe(640);
  });

  it('returning to the rewritten entry later restores it like any other entry', async () => {
    const { history, router, canvas, scroll } = await renderEditor(PAGE_A);
    await dropFix(router);
    await until(quiet, 'the rewrite settled');
    await scroll(420);
    // A new entry pushed straight on top (not through a link, so the rewritten entry is left as it is).
    await act(async () => {
      await router.navigate({ to: '/app/projects/$projectId/editor', params: { projectId: 'project-1' }, search: { page: 'page-a' }, hash: 'usage' });
    });
    await until(() => router.state.location.hash === 'usage' && scrolled.length > 0, 'the landing on Usage');
    await scroll(1500);
    await act(async () => history.back());
    await until(() => router.state.location.hash === '' && quiet(), 'the rewritten entry');
    expect(canvas().scrollTop).toBe(420);
  });
});

describe('a new tab carries the section (#553)', () => {
  it('builds the linked page’s editor address with its section', async () => {
    await renderEditor();
    expect(harness.pages?.href('page-b')).toBe('/app/projects/project-1/editor?page=page-b');
    expect(harness.pages?.href('page-b', 'install')).toBe('/app/projects/project-1/editor?page=page-b#install');
  });
});
