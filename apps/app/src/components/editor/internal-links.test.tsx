/** @vitest-environment jsdom */
/**
 * PUBLIC-18: in the editor, a link to another page of the site (stored
 * relative) must never open the dashboard's own address. The link bubble's
 * Open and Ctrl/⌘/middle-click open the linked page in the editor; a link that
 * reaches no page says so; web addresses keep the browser's behaviour; and the
 * link mark, its HTML and its Markdown keep the relative address.
 */

import { type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { Editor } from '@tiptap/core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const translate = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, 'en');
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => translate }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ projectId: 'project-1' }) }));
vi.mock('./active-branch-context', () => ({ useActiveBranchId: () => 'main' }));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ data: [{ id: 'en', code: 'en' }] }),
  usePages: () => ({ data: [] }),
}));

import { LinkEditorPanel } from './editor-bubble-menu';
import { type EditorLinks, EditorLinksContext, type EditorLinkTarget } from './editor-links';
import { buildEditorExtensions } from './tiptap-editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const TARGETS: Record<string, EditorLinkTarget> = {
  configuration: { kind: 'page', pageId: 'page-config' },
  '/guides/setup#install': { kind: 'page', pageId: 'page-setup', anchor: 'install' },
  '/nowhere': { kind: 'missing' },
  'https://example.com/docs': { kind: 'web' },
  // Into another docs version whose pages aren't loaded yet.
  '/v2/setup': { kind: 'unknown' },
  // A section of the page being edited.
  '#options': { kind: 'page', pageId: 'page-current', anchor: 'options' },
  '/files/guide.pdf': { kind: 'other' },
};
/** Where links lead once every version's pages are loaded. */
const RESOLVED: Record<string, EditorLinkTarget> = { '/v2/setup': { kind: 'page', pageId: 'page-v2-setup' } };

const makeLinks = () => ({
  resolve: (href: string): EditorLinkTarget => TARGETS[href] ?? { kind: 'other' },
  open: vi.fn<(pageId: string, section?: string) => void>(),
  href: (pageId: string, section?: string) => `/app/projects/project-1/editor?page=${pageId}${section ? `#${section}` : ''}`,
  resolveAsync: vi.fn(async (href: string): Promise<EditorLinkTarget> => RESOLVED[href] ?? TARGETS[href] ?? { kind: 'other' }),
  loadVersions: vi.fn(),
});
type TestLinks = ReturnType<typeof makeLinks>;

const roots: Array<ReturnType<typeof createRoot>> = [];
const editors: Editor[] = [];
let windowOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  windowOpen = vi.fn();
  vi.stubGlobal('open', windowOpen);
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** An editor whose only paragraph is a link to `href`. */
function editorWithLink(href: string, { links, editable = true }: { links?: TestLinks | null; editable?: boolean } = {}) {
  const host = document.createElement('div');
  host.lang = 'en';
  document.body.append(host);
  const editor = new Editor({
    element: host,
    editable,
    extensions: buildEditorExtensions({ getLinks: () => links ?? null }),
    content: `<p><a href="${href}">the guide</a></p>`,
  });
  editors.push(editor);
  const anchor = editor.view.dom.querySelector('a');
  if (!anchor) throw new Error('No link in the page');
  return { editor, anchor };
}

const click = (target: Element, init: MouseEventInit = {}, type: 'click' | 'auxclick' = 'click') => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
};

async function renderPanel(href: string, links: EditorLinks | null) {
  const { editor } = editorWithLink(href);
  editor.commands.setTextSelection(3);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const onDone = vi.fn();
  await act(async () =>
    root.render(
      <EditorLinksContext.Provider value={links}>
        <LinkEditorPanel editor={editor} initialUrl={href} onDone={onDone} />
      </EditorLinksContext.Provider>,
    ),
  );
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  const buttons = [...container.querySelectorAll('button')];
  const open =
    buttons.find((button) => button.getAttribute('aria-label') === translate('editor.link.openPage')) ??
    buttons.find((button) => button.getAttribute('aria-label') === translate('editor.link.openSection')) ??
    buttons.find((button) => button.getAttribute('aria-label') === translate('editor.link.open'));
  if (!open) throw new Error('No Open button');
  return { editor, open, onDone, container };
}

const reasonOf = (button: HTMLElement) =>
  (button.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .map((id) => (id ? document.getElementById(id)?.textContent : ''))
    .join(' ')
    .trim();

describe('the link bubble opens internal links in the editor (PUBLIC-18)', () => {
  it('opens the linked page in the editor, not the app address', async () => {
    const links = makeLinks();
    const { open, onDone } = await renderPanel('configuration', links);
    expect(open.getAttribute('aria-label')).toBe(translate('editor.link.openPage'));
    expect(open.hasAttribute('disabled') || open.getAttribute('aria-disabled') === 'true').toBe(false);
    await act(async () => open.click());
    expect(links.open).toHaveBeenCalledWith('page-config', undefined);
    expect(onDone).toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('opens a root link with an #anchor on its page, at that section (#553)', async () => {
    const links = makeLinks();
    const { open } = await renderPanel('/guides/setup#install', links);
    await act(async () => open.click());
    expect(links.open).toHaveBeenCalledWith('page-setup', 'install');
  });

  it('goes to a section of the page being edited (#553)', async () => {
    const links = makeLinks();
    const { open, onDone } = await renderPanel('#options', links);
    expect(open.getAttribute('aria-label')).toBe(translate('editor.link.openSection'));
    expect(translate('editor.link.openSection')).toBe('Go to this section');
    expect(open.getAttribute('aria-disabled') === 'true' || open.hasAttribute('disabled')).toBe(false);
    await act(async () => open.click());
    expect(onDone).toHaveBeenCalled();
    expect(links.open).toHaveBeenCalledWith('page-current', 'options');
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('keeps Open disabled for a link to no page, and says why', async () => {
    const links = makeLinks();
    const { open } = await renderPanel('/nowhere', links);
    expect(open.getAttribute('aria-disabled') === 'true' || open.hasAttribute('disabled')).toBe(true);
    expect(reasonOf(open)).toBe(translate('editor.link.missingPage'));
    expect(translate('editor.link.missingPage')).toBe("This page doesn't exist on this site");
    await act(async () => open.click());
    expect(links.open).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('opens a web address in a new tab, as before', async () => {
    const links = makeLinks();
    const { open } = await renderPanel('https://example.com/docs', links);
    expect(open.getAttribute('aria-label')).toBe(translate('editor.link.open'));
    await act(async () => open.click());
    expect(windowOpen).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
    expect(links.open).not.toHaveBeenCalled();
  });

  it('outside the page editor, a site link stays unopenable', async () => {
    const { open } = await renderPanel('configuration', null);
    expect(open.getAttribute('aria-disabled') === 'true' || open.hasAttribute('disabled')).toBe(true);
    expect(reasonOf(open)).toBe(translate('editor.link.openRelativeHint'));
  });
});

describe('clicks on internal links in the page (PUBLIC-18)', () => {
  it('Ctrl+click opens the linked page’s editor in a new tab, never the app address', () => {
    const links = makeLinks();
    const { anchor } = editorWithLink('configuration', { links });
    const event = click(anchor, { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(windowOpen).toHaveBeenCalledWith('/app/projects/project-1/editor?page=page-config', '_blank', 'noopener');
    expect(links.open).not.toHaveBeenCalled();
  });

  it('⌘+click and middle-click do the same', () => {
    const links = makeLinks();
    const { anchor } = editorWithLink('configuration', { links });
    expect(click(anchor, { metaKey: true }).defaultPrevented).toBe(true);
    expect(click(anchor, { button: 1 }, 'auxclick').defaultPrevented).toBe(true);
    expect(windowOpen).toHaveBeenCalledTimes(2);
    expect(windowOpen).toHaveBeenLastCalledWith('/app/projects/project-1/editor?page=page-config', '_blank', 'noopener');
  });

  it('a plain click while editing only places the caret: no navigation', () => {
    const links = makeLinks();
    const { anchor } = editorWithLink('configuration', { links });
    expect(click(anchor).defaultPrevented).toBe(true);
    expect(windowOpen).not.toHaveBeenCalled();
    expect(links.open).not.toHaveBeenCalled();
  });

  it('a plain click (or Enter) on a link in a read-only page opens the page in the editor', () => {
    const links = makeLinks();
    const { anchor } = editorWithLink('configuration', { links, editable: false });
    // Enter on a focused link dispatches a click with no pointer.
    expect(click(anchor, { detail: 0 }).defaultPrevented).toBe(true);
    expect(links.open).toHaveBeenCalledWith('page-config', undefined);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('Ctrl+click on a link to a section opens the page’s editor at that section in a new tab (#553)', () => {
    const links = makeLinks();
    const { anchor } = editorWithLink('/guides/setup#install', { links });
    expect(click(anchor, { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(windowOpen).toHaveBeenCalledWith('/app/projects/project-1/editor?page=page-setup#install', '_blank', 'noopener');
  });

  it('a plain click on a link to a section of a read-only page opens it at that section (#553)', () => {
    const links = makeLinks();
    const { anchor } = editorWithLink('/guides/setup#install', { links, editable: false });
    expect(click(anchor, { detail: 0 }).defaultPrevented).toBe(true);
    expect(links.open).toHaveBeenCalledWith('page-setup', 'install');
  });

  it('a plain click on an in-page #section link of a read-only page jumps there (#553)', () => {
    const links = makeLinks();
    const { anchor } = editorWithLink('#options', { links, editable: false });
    expect(click(anchor, { detail: 0 }).defaultPrevented).toBe(true);
    expect(links.open).toHaveBeenCalledWith('page-current', 'options');
  });

  it('Ctrl+click on a link to no page does nothing, and never opens the app address', () => {
    const links = makeLinks();
    const { anchor } = editorWithLink('/nowhere', { links });
    expect(click(anchor, { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(click(anchor, { button: 1 }, 'auxclick').defaultPrevented).toBe(true);
    expect(windowOpen).not.toHaveBeenCalled();
    expect(links.open).not.toHaveBeenCalled();
  });

  it('without the page editor, Ctrl+click on a site link still never opens the app address', () => {
    const { anchor } = editorWithLink('configuration');
    expect(click(anchor, { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('leaves web addresses to the browser', () => {
    const links = makeLinks();
    const { anchor } = editorWithLink('https://example.com/docs', { links });
    expect(click(anchor, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click(anchor, { button: 1 }, 'auxclick').defaultPrevented).toBe(false);
    expect(windowOpen).not.toHaveBeenCalled();
  });
});

describe('internal links keep their address (PUBLIC-18)', () => {
  it('the mark, the HTML and the Markdown keep the relative href, before and after a click', () => {
    const links = makeLinks();
    const { editor, anchor } = editorWithLink('configuration', { links });
    const serialized = () => ({
      href: editor.getAttributes('link').href as string | undefined,
      html: editor.getHTML(),
      markdown: (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown(),
      dom: anchor.getAttribute('href'),
    });
    editor.commands.setTextSelection(3);
    const before = serialized();
    expect(before.href).toBe('configuration');
    expect(before.html).toContain('href="configuration"');
    expect(before.markdown).toBe('[the guide](configuration)');
    expect(before.dom).toBe('configuration');
    click(anchor, { ctrlKey: true });
    click(anchor);
    expect(serialized()).toEqual(before);
  });

  it('copying the link puts the relative href on the clipboard', () => {
    const { editor } = editorWithLink('/guides/setup#install', { links: makeLinks() });
    editor.commands.selectAll();
    const { dom } = editor.view.serializeForClipboard(editor.state.selection.content());
    expect(dom.querySelector('a')?.getAttribute('href')).toBe('/guides/setup#install');
  });
});

describe('council fixes: clicks that edit, and links that keep their default (PUBLIC-18)', () => {
  it('a /files/guide.pdf click keeps the browser’s behaviour', () => {
    const links = makeLinks();
    for (const href of ['/files/guide.pdf']) {
      const { anchor } = editorWithLink(href, { links });
      expect(click(anchor).defaultPrevented).toBe(false);
      expect(click(anchor, { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(click(anchor, { button: 1 }, 'auxclick').defaultPrevented).toBe(false);
    }
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('page and missing-page clicks are prevented', () => {
    const links = makeLinks();
    expect(click(editorWithLink('configuration', { links }).anchor).defaultPrevented).toBe(true);
    expect(click(editorWithLink('/nowhere', { links }).anchor).defaultPrevented).toBe(true);
  });

  it('Shift+click that extends a selection selects, and opens no tab', () => {
    const links = makeLinks();
    const { editor, anchor } = editorWithLink('configuration', { links });
    editor.commands.setTextSelection({ from: 1, to: 4 });
    expect(click(anchor, { shiftKey: true }).defaultPrevented).toBe(true);
    expect(windowOpen).not.toHaveBeenCalled();
    expect(links.open).not.toHaveBeenCalled();
  });

  it('a Ctrl+click while composing text (IME) opens no tab', () => {
    const links = makeLinks();
    const { editor, anchor } = editorWithLink('configuration', { links });
    Object.defineProperty(editor.view, 'composing', { configurable: true, get: () => true });
    click(anchor, { ctrlKey: true });
    click(anchor, { button: 1 }, 'auxclick');
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('a drag-select that ends on a link opens no tab', () => {
    const links = makeLinks();
    const { anchor } = editorWithLink('configuration', { links });
    // jsdom has no layout: ProseMirror's own mousedown handling asks for one.
    Object.assign(document, { elementFromPoint: () => null });
    anchor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, detail: 1 }));
    click(anchor, { ctrlKey: true, clientX: 180, clientY: 12, detail: 1 });
    expect(windowOpen).not.toHaveBeenCalled();
    // A click where the pointer went down still opens.
    anchor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 40, clientY: 10, detail: 1 }));
    click(anchor, { ctrlKey: true, clientX: 41, clientY: 10, detail: 1 });
    expect(windowOpen).toHaveBeenCalledWith('/app/projects/project-1/editor?page=page-config', '_blank', 'noopener');
  });
});

describe('council fixes: links into another docs version (PUBLIC-18)', () => {
  it('a link to /v2/<page> is not marked missing: Open stays available, loads the version, and opens the page', async () => {
    const links = makeLinks();
    const { open, onDone } = await renderPanel('/v2/setup', links);
    expect(open.getAttribute('aria-label')).toBe(translate('editor.link.openPage'));
    expect(open.getAttribute('aria-disabled') === 'true' || open.hasAttribute('disabled')).toBe(false);
    expect(reasonOf(open)).toBe('');
    expect(links.loadVersions).toHaveBeenCalled();
    await act(async () => open.click());
    expect(links.resolveAsync).toHaveBeenCalledWith('/v2/setup');
    expect(onDone).toHaveBeenCalled();
    expect(links.open).toHaveBeenCalledWith('page-v2-setup', undefined);
  });

  it('Ctrl+click on a link into another version opens that page’s editor in a new tab once resolved', async () => {
    const links = makeLinks();
    const tab = { opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    windowOpen.mockReturnValue(tab);
    const { anchor } = editorWithLink('/v2/setup', { links });
    expect(click(anchor, { ctrlKey: true }).defaultPrevented).toBe(true);
    // Opened during the click, so the browser allows it, then sent to the page.
    expect(windowOpen).toHaveBeenCalledWith('about:blank', '_blank');
    await act(() => Promise.resolve()); // Let the resolution settle.
    expect(tab.opener).toBeNull();
    expect(tab.location.replace).toHaveBeenCalledWith('/app/projects/project-1/editor?page=page-v2-setup');
    expect(tab.close).not.toHaveBeenCalled();
  });
});
