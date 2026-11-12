/** @vitest-environment jsdom */
/**
 * #553: following a link to `page#section` in the editor opens the page and
 * lands on that heading, with the caret (and focus) at its start, as the
 * published site lands on it. An unknown section stays at the top, an in-page
 * `#section` link jumps within the page, Back and Forward keep working, a new
 * tab gets the section too, and reduced motion gets an instant jump.
 */
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { EditorContent, useEditor } from '@tiptap/react';
import { act, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type EditorLinks, EditorLinksContext, editorLinkResolver } from './editor-links';
import { type LinkedPages, useLinkedPageHistory } from './linked-page-history';
import { buildEditorExtensions, seedMarkdown } from './tiptap-editor';

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

const harness: { pages?: LinkedPages; editable: boolean; editors: Map<string, import('@tiptap/core').Editor> } = {
  editable: true,
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
    onCreate: ({ editor: created }) => queueMicrotask(() => !created.isDestroyed && seedMarkdown(created, PAGES[pageId] ?? '')),
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

beforeEach(() => {
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

const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((done) => requestAnimationFrame(() => done(null)));
  });

async function renderEditor(start = '/app/projects/project-1/editor') {
  const history = createMemoryHistory({ initialEntries: [start] });
  const router = createRouter({ routeTree: rootRoute.addChildren([editorRoute]), history });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<RouterProvider router={router} />));
  await act(async () => router.load());
  await settle();
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
    await settle();
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
    await settle();
    expect(scrolled.at(-1)?.element).toBe(heading(canvas(), 'Setup', 1));
    expect(caret(editor()).block).toBe('Setup');
    // The second "Setup": the caret is in the heading after "The first setup."
    const { $from } = editor().state.selection;
    expect(editor().state.doc.textBetween(0, $from.pos, '\n')).toContain('The first setup.');
  });

  it('finds an Arabic heading from an encoded or a plain fragment', async () => {
    const { canvas } = await renderEditor();
    await act(async () => harness.pages?.open('page-b', 'تثبيت-الأداة'));
    await settle();
    expect(scrolled.at(-1)?.element).toBe(heading(canvas(), 'تثبيت الأداة'));
  });

  it('an unknown section stays at the top, with no error', async () => {
    const errors = vi.spyOn(console, 'error');
    const { router, canvas, scroll, editor } = await renderEditor();
    await scroll(300);
    await act(async () => harness.pages?.open('page-b', 'no-such-section'));
    await settle();
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
    await settle();
    expect(scrolled).toEqual([]);
    expect(canvas().scrollTop).toBe(0);
  });

  it('reduced motion gets an instant jump', async () => {
    reducedMotion = true;
    const { canvas } = await renderEditor();
    await act(async () => harness.pages?.open('page-b', 'install'));
    await settle();
    expect(scrolled.at(-1)?.element).toBe(heading(canvas(), 'Install'));
    expect(scrolled.at(-1)?.options).toMatchObject({ block: 'start', behavior: 'auto' });
  });

  it('a read-only page puts focus on the heading itself', async () => {
    harness.editable = false;
    const { canvas } = await renderEditor();
    await act(async () => harness.pages?.open('page-b', 'install'));
    await settle();
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
    await settle();
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
    await settle();
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
    await settle();
    expect(router.state.location.hash).toBe('install');
    // Where the jump left the page.
    await scroll(640);

    await act(async () => history.back());
    await settle();
    expect(router.state.location.search).toEqual({ page: 'page-a' });
    expect(router.state.location.hash).toBe('');
    expect(canvas().dataset.page).toBe('page-a');
    expect(canvas().scrollTop).toBe(420);

    await act(async () => history.forward());
    await settle();
    expect(router.state.location.search).toEqual({ page: 'page-b' });
    expect(router.state.location.hash).toBe('install');
    expect(canvas().dataset.page).toBe('page-b');
    expect(canvas().scrollTop).toBe(640);
  });

  it('Back after an in-page jump returns to where the page was', async () => {
    const { history, router, canvas, scroll } = await renderEditor();
    await scroll(120);
    await act(async () => harness.pages?.open('page-a', 'usage'));
    await settle();
    await scroll(500);
    await act(async () => history.back());
    await settle();
    expect(router.state.location.hash).toBe('');
    expect(canvas().scrollTop).toBe(120);
  });

  it('an editor opened at page#section (a new tab, a reload) lands on the section', async () => {
    const { canvas } = await renderEditor('/app/projects/project-1/editor?page=page-b#setup-1');
    expect(canvas().dataset.page).toBe('page-b');
    expect(scrolled.at(-1)?.element).toBe(heading(canvas(), 'Setup', 1));
  });
});

describe('a new tab carries the section (#553)', () => {
  it('builds the linked page’s editor address with its section', async () => {
    await renderEditor();
    expect(harness.pages?.href('page-b')).toBe('/app/projects/project-1/editor?page=page-b');
    expect(harness.pages?.href('page-b', 'install')).toBe('/app/projects/project-1/editor?page=page-b#install');
  });
});
