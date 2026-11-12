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
  '/guides/setup#install': { kind: 'page', pageId: 'page-setup' },
  '/nowhere': { kind: 'missing' },
  'https://example.com/docs': { kind: 'web' },
};

const makeLinks = (): EditorLinks & { open: ReturnType<typeof vi.fn> } => ({
  resolve: (href) => TARGETS[href] ?? { kind: 'other' },
  open: vi.fn(),
  href: (pageId) => `/app/projects/project-1/editor?page=${pageId}`,
});

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
function editorWithLink(href: string, { links, editable = true }: { links?: EditorLinks | null; editable?: boolean } = {}) {
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
    expect(links.open).toHaveBeenCalledWith('page-config');
    expect(onDone).toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('opens a root link with an #anchor on its page', async () => {
    const links = makeLinks();
    const { open } = await renderPanel('/guides/setup#install', links);
    await act(async () => open.click());
    expect(links.open).toHaveBeenCalledWith('page-setup');
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
    expect(links.open).toHaveBeenCalledWith('page-config');
    expect(windowOpen).not.toHaveBeenCalled();
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
