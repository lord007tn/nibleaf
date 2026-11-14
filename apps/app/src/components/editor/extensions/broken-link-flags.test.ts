// @vitest-environment jsdom
/**
 * P1-ED-002: the "Page not found" flag follows every way a link's page can
 * change, with one resolver for the editor's whole life (as the page editor
 * keeps it), so nothing but the edit itself can refresh the flags:
 * - a mark-only edit (pointing the link elsewhere) has an empty position map;
 * - undo and redo apply it as one `MarkSetStep`, with no range of its own;
 * - a paste replaces the link.
 */
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditorLinks, EditorLinkTarget } from '../editor-links';
import { buildEditorExtensions } from '../tiptap-editor';

const resolve = (href: string): EditorLinkTarget => (href === '/guide' ? { kind: 'page', pageId: 'guide' } : { kind: 'missing' });
const LINKS = { resolve } as unknown as EditorLinks;

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function open(html: string) {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ getLinks: () => LINKS }), content: html });
  editors.push(editor);
  const flags = () => [...editor.view.dom.querySelectorAll<HTMLElement>('.pl-broken-link')].map((element) => element.dataset.brokenLink);
  /** Select the text of the first link to `href`. */
  const select = (href: string) => {
    let range: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (!range && node.isText && node.marks.some((mark) => mark.attrs.href === href)) range = { from: pos, to: pos + node.nodeSize };
      return !range;
    });
    if (!range) throw new Error(`No link to ${href}`);
    editor.commands.setTextSelection(range);
  };
  const point = (from: string, to: string) => {
    select(from);
    editor.chain().extendMarkRange('link').setLink({ href: to }).run();
  };
  return { editor, flags, select, point };
}

describe('broken-link flags follow the link', () => {
  it('pointing a link at a page that exists clears its flag; at a missing one raises it', () => {
    const { flags, point } = open('<p>See <a href="/configuration">the configuration</a> and <a href="/guide">the guide</a>.</p>');
    expect(flags()).toEqual(['/configuration']);
    point('/configuration', '/guide');
    expect(flags()).toEqual([]);
    point('/guide', '/nowhere');
    expect(flags()).toEqual(['/nowhere']);
  });

  it('undo and redo bring the flag back and take it away again', () => {
    const { editor, flags, point } = open('<p>See <a href="/configuration">the configuration</a>.</p>');
    point('/configuration', '/guide');
    expect(flags()).toEqual([]);
    editor.commands.undo();
    expect(flags()).toEqual(['/configuration']);
    editor.commands.redo();
    expect(flags()).toEqual([]);
  });

  it('removing a link removes its flag', () => {
    const { editor, flags, select } = open('<p>See <a href="/configuration">the configuration</a>.</p>');
    select('/configuration');
    editor.chain().extendMarkRange('link').unsetLink().run();
    expect(flags()).toEqual([]);
    editor.commands.undo();
    expect(flags()).toEqual(['/configuration']);
  });

  it('pasting over a link flags what was pasted, and nothing of what it replaced', () => {
    const { editor, flags, select } = open('<p>See <a href="/configuration">the configuration</a> and <a href="/guide">the guide</a>.</p>');
    // jsdom has no ClipboardEvent: a plain paste event carries the HTML instead.
    const paste = () => new Event('paste') as ClipboardEvent;
    select('/guide');
    editor.view.pasteHTML('<a href="/elsewhere">elsewhere</a>', paste());
    expect(flags()).toEqual(['/configuration', '/elsewhere']);
    select('/configuration');
    editor.view.pasteHTML('<a href="/guide">the guide again</a>', paste());
    expect(flags()).toEqual(['/elsewhere']);
  });

  it('an edit across many paragraphs (read again in one pass) keeps every flag right', () => {
    const paragraphs = Array.from({ length: 30 }, (_, index) =>
      index % 2 ? `<p><a href="/missing-${index}">gone ${index}</a></p>` : `<p><a href="/guide">guide ${index}</a></p>`,
    ).join('');
    const { editor, flags } = open(paragraphs);
    const broken = Array.from({ length: 15 }, (_, index) => `/missing-${index * 2 + 1}`);
    expect(flags()).toEqual(broken);
    const { bold, link } = editor.schema.marks;
    if (!(bold && link)) throw new Error('No marks');
    // One bold toggle over the page: every flag stays.
    editor.view.dispatch(editor.state.tr.addMark(0, editor.state.doc.content.size, bold.create()));
    expect(flags()).toEqual(broken);
    // One transaction pointing every broken link at a page that exists: every flag goes.
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((mark) => String(mark.attrs.href).startsWith('/missing')))
        tr.addMark(pos, pos + node.nodeSize, link.create({ href: '/guide' }));
    });
    editor.view.dispatch(tr);
    expect(flags()).toEqual([]);
    editor.commands.undo();
    expect(flags()).toEqual(broken);
  });

  it('a link changed in a paragraph far from the edit’s other steps is still looked at', () => {
    const paragraphs = Array.from({ length: 30 }, (_, index) => `<p>Paragraph ${index}.</p>`).join('');
    const { editor, flags, select } = open(`<p><a href="/configuration">first</a></p>${paragraphs}<p><a href="/guide">last</a></p>`);
    expect(flags()).toEqual(['/configuration']);
    select('/guide');
    const { from, to } = editor.state.selection;
    const link = editor.schema.marks.link;
    if (!link) throw new Error('No link mark');
    // One transaction: text typed at the start (a step that moves content), and the last link pointed at a missing page.
    const tr = editor.state.tr.insertText('x', 1).addMark(from + 1, to + 1, link.create({ href: '/gone' }));
    editor.view.dispatch(tr);
    expect(flags()).toEqual(['/configuration', '/gone']);
  });
});
