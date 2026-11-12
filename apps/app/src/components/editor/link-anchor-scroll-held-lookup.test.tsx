/** @vitest-environment jsdom */
/**
 * #553 (council on #577): the writer wins over a landing whose section lookup
 * is still pending. The editor loads the reader's heading pass lazily; here
 * that import is held by hand, so the landing waits on it while the writer
 * types, clicks, or moves focus to a field. Only once the writer has acted is
 * the import released, and only once the lookup has settled (the import
 * resolved, the reader's headings read, the landing's continuation run, no
 * frame pending) do the assertions run: the caret and focus are where the
 * writer left them, and nothing scrolled.
 *
 * The editor keeps the loaded module once it has it, so each test starts from
 * a fresh module registry (`vi.resetModules`) with the import held again
 * (`vi.doMock`), loaded in `beforeEach`. The fast path, with the module
 * already loaded, is covered by `link-anchor-scroll.test.tsx`.
 */
// Loaded once with the file, so each test's fresh registry re-evaluates them instead of transforming them.
import '@tanstack/react-router';
import '@tiptap/react';
import './editor-links';
import './linked-page-history';
import './tiptap-editor';
import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGES: Record<string, string> = {
  'page-a': ['# Overview', 'See [how to install](page-b#install).', 'Text.'].join('\n\n'),
  'page-b': ['## Before you start', 'Read this first.', '## Install', 'Run the installer.', '## Setup', 'Then set it up.'].join('\n\n'),
};

/** The held import of the reader's heading pass: requested by the landing, released by the test. */
interface HeldLookup {
  requested: boolean;
  release: () => void;
  /** Calls of the reader's heading pass since the release: the lookup has run. */
  reads: number;
}
let held: HeldLookup;

/** Animation frames requested and not run yet (the editor's own frames are controlled here). */
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let scrolled: Element[];
const unmounts: Array<() => Promise<void>> = [];
let modules: Awaited<ReturnType<typeof loadModules>>;

/** The page editor's modules from the current (fresh) registry, with the reader's heading pass held. */
async function loadModules() {
  return {
    react: await import('react'),
    client: await import('react-dom/client'),
    router: await import('@tanstack/react-router'),
    tiptap: await import('@tiptap/react'),
    links: await import('./editor-links'),
    sections: await import('./editor-sections'),
    history: await import('./linked-page-history'),
    editor: await import('./tiptap-editor'),
  };
}

beforeAll(async () => {
  // Transform the real module once, so a release resolves at once rather than waiting on a transform.
  await vi.importActual('@nibleaf/shared/reader-headings');
});

beforeEach(async () => {
  frames.clear();
  scrolled = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  // jsdom has no layout: record where the editor asks to scroll.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  Object.assign(document, { elementFromPoint: () => null });

  let release: () => void = () => undefined;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  held = { requested: false, release: () => release(), reads: 0 };
  vi.resetModules();
  vi.doMock('@nibleaf/shared/reader-headings', async (importOriginal: () => Promise<typeof import('@nibleaf/shared/reader-headings')>) => {
    held.requested = true;
    await gate;
    const real = await importOriginal();
    return {
      ...real,
      readerHeadings: (content: string) => {
        held.reads += 1;
        return real.readerHeadings(content);
      },
    };
  });
  modules = await loadModules();
});

afterEach(async () => {
  for (const unmount of unmounts.splice(0)) await unmount();
  document.body.replaceChildren();
  vi.doUnmock('@nibleaf/shared/reader-headings');
  vi.unstubAllGlobals();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

/** The page editor in miniature, from a fresh module registry: the router, the history hook, and one real editor per page. */
async function renderEditor() {
  const { act, createElement, useEffect, useMemo, useRef, useState } = modules.react;
  const { createRoot } = modules.client;
  const { router } = modules;
  const { EditorContent, useEditor } = modules.tiptap;
  const { EditorLinksContext, editorLinkResolver } = modules.links;
  const { editorIn } = modules.sections;
  const { useLinkedPageHistory } = modules.history;
  const { buildEditorExtensions, seedMarkdown } = modules.editor;
  type Links = import('./editor-links').EditorLinks;

  const editors = new Map<string, Editor>();
  const screen: { open?: (id: string, section?: string) => Promise<void> } = {};

  function PageEditor({ pageId, links }: { pageId: string; links: Links }) {
    const linksRef = useRef(links);
    linksRef.current = links;
    const editor = useEditor({
      extensions: buildEditorExtensions({ getLinks: () => linksRef.current }),
      content: PAGES[pageId] ?? '',
      onCreate: ({ editor: created }) => queueMicrotask(() => !created.isDestroyed && seedMarkdown(created, PAGES[pageId] ?? '')),
    });
    useEffect(() => {
      if (editor) editors.set(pageId, editor);
    }, [editor, pageId]);
    return createElement(EditorContent, { editor });
  }

  /** The page editor in miniature: it opens on page A, and selects the page `?page=` names, as the route does. */
  function EditorScreen(): ReactNode {
    const { page } = editorRoute.useSearch();
    const [selected, setSelected] = useState(page ?? 'page-a');
    useEffect(() => {
      if (page) setSelected(page);
    }, [page]);
    const canvas = useRef<HTMLDivElement>(null);
    const pages = useLinkedPageHistory({ projectId: 'project-1', pageId: selected, canvas: () => canvas.current });
    screen.open = pages.open;
    const links = useMemo<Links>(
      () => ({
        resolve: editorLinkResolver(null, selected),
        open: (id, section) => void pages.open(id, section),
        href: pages.href,
        resolveAsync: async (href) => editorLinkResolver(null, selected)(href),
        loadVersions: () => undefined,
      }),
      [pages, selected],
    );
    return createElement(
      EditorLinksContext.Provider,
      { value: links },
      createElement(
        'div',
        { ref: canvas, 'data-testid': 'canvas', 'data-page': selected },
        createElement(PageEditor, { key: selected, pageId: selected, links }),
      ),
    );
  }

  const rootRoute = router.createRootRoute({ component: router.Outlet });
  const editorRoute = router.createRoute({
    getParentRoute: () => rootRoute,
    path: '/app/projects/$projectId/editor',
    validateSearch: (search: Record<string, unknown>) => ({ page: typeof search.page === 'string' ? search.page : undefined }),
    component: EditorScreen,
  });
  const appRouter = router.createRouter({
    routeTree: rootRoute.addChildren([editorRoute]),
    history: router.createMemoryHistory({ initialEntries: ['/app/projects/project-1/editor'] }),
  });

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  unmounts.push(() => act(async () => root.unmount()));
  await act(async () => root.render(createElement(router.RouterProvider, { router: appRouter })));
  await act(async () => appRouter.load());

  const canvas = () => container.querySelector<HTMLDivElement>('[data-testid="canvas"]');
  /** Wait for `ready()`: each round runs the due frames, then lets React, promises and timers settle. Bounded inside the test's 5 s. */
  const until = (ready: () => boolean, what: string) =>
    vi.waitFor(
      async () => {
        await act(async () => {
          const due = [...frames.values()];
          frames.clear();
          for (const callback of due) callback(performance.now());
          await new Promise((done) => setTimeout(done, 0));
        });
        if (!ready()) throw new Error(`Still waiting for ${what}`);
      },
      { timeout: 4000, interval: 1 },
    );
  /** The canvas shows `pageId` in an editor holding its seeded content. */
  const shows = (pageId: string) => canvas()?.dataset.page === pageId && editorIn(canvas()) === editors.get(pageId) && editors.has(pageId);
  const editor = (pageId: string) => {
    const found = editors.get(pageId);
    if (!found) throw new Error(`No editor for ${pageId}`);
    return found;
  };

  await until(() => shows('page-a'), 'page A');

  /** Follow the link to page-b#install, and wait until the landing is held on its lookup. */
  const followHeldLink = async () => {
    await act(async () => screen.open?.('page-b', 'install'));
    await until(() => shows('page-b') && held.requested && frames.size === 0, 'the landing held on its lookup');
    expect(held.reads).toBe(0);
    expect(scrolled).toEqual([]);
  };
  /** Release the lookup, and wait until it has settled: the import resolved, the headings read, the landing done, no frame pending. */
  const releaseAndSettle = async () => {
    held.release();
    await until(() => held.reads > 0 && frames.size === 0, 'the released lookup to settle');
    // One more round: the landing's continuation after the lookup (end, or land) has run.
    await until(() => frames.size === 0, 'no frame pending');
  };

  return { act, canvas, editor, followHeldLink, releaseAndSettle };
}

/** The text of the block the caret is in, and its offset there. */
const caret = (editor: Editor) => ({
  block: editor.state.selection.$from.parent.textContent,
  offset: editor.state.selection.$from.parentOffset,
  from: editor.state.selection.from,
});
/** A position inside the paragraph with this text. */
const insideParagraph = (editor: Editor, text: string, offset: number) => {
  let position = -1;
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === 'paragraph' && node.textContent === text) position = at + 1 + offset;
    return position < 0;
  });
  if (position < 0) throw new Error(`No paragraph "${text}"`);
  return position;
};

describe('the writer wins over a landing whose lookup is still pending (#553 council, #577)', () => {
  it('typing into the editor while the lookup is held keeps the caret where the writer typed', async () => {
    const { act, editor, followHeldLink, releaseAndSettle } = await renderEditor();
    await followHeldLink();
    const page = editor('page-b');
    await act(async () => {
      page.commands.setTextSelection(insideParagraph(page, 'Read this first.', 4));
      page.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }));
      page.view.dom.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'z', bubbles: true, cancelable: true }));
      page.commands.insertContent('z');
    });
    const typed = caret(page);
    expect(typed).toMatchObject({ block: 'Readz this first.', offset: 5 });

    await releaseAndSettle();
    expect(caret(page)).toEqual(typed);
    expect(scrolled).toEqual([]);
  });

  it('a click in the editor while the lookup is held keeps the caret where the writer clicked', async () => {
    const { act, editor, followHeldLink, releaseAndSettle } = await renderEditor();
    await followHeldLink();
    const page = editor('page-b');
    const paragraph = page.view.nodeDOM(insideParagraph(page, 'Then set it up.', 0) - 1) as HTMLElement;
    await act(async () => {
      paragraph.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      page.commands.setTextSelection(insideParagraph(page, 'Then set it up.', 5));
    });
    const clicked = caret(page);
    expect(clicked).toMatchObject({ block: 'Then set it up.', offset: 5 });

    await releaseAndSettle();
    expect(caret(page)).toEqual(clicked);
    expect(scrolled).toEqual([]);
  });

  it('focus moved to a field while the lookup is held stays in the field', async () => {
    const { editor, followHeldLink, releaseAndSettle } = await renderEditor();
    await followHeldLink();
    const page = editor('page-b');
    const before = caret(page);
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Page title');
    document.body.append(field);
    field.focus();
    expect(document.activeElement).toBe(field);

    await releaseAndSettle();
    expect(document.activeElement).toBe(field);
    expect(caret(page)).toEqual(before);
    expect(caret(page).block).not.toBe('Install');
    expect(scrolled).toEqual([]);
  });
});
