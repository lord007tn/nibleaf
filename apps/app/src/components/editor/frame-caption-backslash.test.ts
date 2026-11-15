// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * A Frame's quoted attribute values are read with the reader's HTML rules, with no
 * backslash escapes (#579): `caption="Old\"` is the caption `Old\`, and the
 * attributes after it stay attributes. Main read the backslash as an escape, missed
 * the opener and dropped the Frame. Every other component reads as on main
 * (`frame-main-differential.test.ts`).
 */

const IFRAME = '<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>';
const ISSUE = `<Frame caption="Old\\" data-lightbox>\n  ${IFRAME}\n</Frame>`;

const editors: Editor[] = [];
const open = (markdown: string) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.commands.setContent(markdown, { emitUpdate: false });
  return editor;
};
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const nodes = (editor: Editor, type: string) => {
  const found: Array<{ node: PMNode; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === type) found.push({ node, pos });
  });
  return found;
};
const setAttributes = (editor: Editor, type: string, attributes: Record<string, unknown>) => {
  const target = nodes(editor, type)[0];
  if (!target) throw new Error(`No ${type}`);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, ...attributes }));
};
/** Load and save `count` times: every save is the page, byte for byte. */
const cycles = (page: string, count = 3) => {
  let current = page;
  for (let cycle = 0; cycle < count; cycle++) {
    current = getMarkdown(open(current));
    expect(current).toBe(page);
  }
};

describe('a Frame caption ending in a backslash (#579)', () => {
  it('keeps the issue’s Frame, caption and data-lightbox, byte for byte over 3 load/save cycles', () => {
    const editor = open(ISSUE);
    expect(nodes(editor, 'videoEmbed').map(({ node }) => node.attrs.caption)).toEqual(['Old\\']);
    expect(getMarkdown(editor)).toBe(ISSUE);
    cycles(ISSUE);
  });

  it.each([
    ['an embed', `<Frame caption="Old\\" data-lightbox>\n  ${IFRAME}\n</Frame>`, 'videoEmbed'],
    ['a video', '<Frame caption="Old\\" id="tour">\n  <video controls src="https://cdn.example.com/a.mp4"></video>\n</Frame>', 'videoEmbed'],
    ['an image', '<Frame caption="Old\\" data-lightbox>\n\n![Diagram](/diagram.png)\n\n</Frame>', 'mdxFrame'],
    ['an HTML image', '<Frame caption="Old\\" data-lightbox>\n\n<img src="/diagram.png" alt="Diagram" />\n\n</Frame>', 'mdxFrame'],
    ['single quotes, an image', "<Frame caption='Old\\' data-lightbox>\n\n![Diagram](/diagram.png)\n\n</Frame>", 'mdxFrame'],
    ['no space before the next attribute, an embed', `<Frame caption="Old\\"data-lightbox>\n  ${IFRAME}\n</Frame>`, 'videoEmbed'],
  ])('keeps a trailing-backslash caption and the attribute after it, with %s inside', (_name, frame, type) => {
    const page = `Intro.\n\n${frame}\n\nOutro.`;
    const editor = open(page);
    expect(nodes(editor, type).map(({ node }) => node.attrs.caption)).toEqual(['Old\\']);
    cycles(page);
    // A caption edit rewrites only the caption.
    setAttributes(editor, type, { caption: 'Edited' });
    expect(getMarkdown(editor)).toBe(page.replace(/caption=(["'])Old\\\1/, 'caption="Edited"'));
  });

  it('writes a caption ending in a backslash as the reader reads it back', () => {
    const editor = open(ISSUE);
    setAttributes(editor, 'videoEmbed', { caption: 'C:\\' });
    const saved = getMarkdown(editor);
    expect(saved).toBe(ISSUE.replace('caption="Old\\"', 'caption="C:\\"'));
    expect(nodes(open(saved), 'videoEmbed').map(({ node }) => node.attrs.caption)).toEqual(['C:\\']);
  });
});

describe('Frame captions main already read', () => {
  it.each([
    ['a JSX string caption', '<Frame caption={"Tour"}>'],
    ['a JSX string caption with an escaped quote', '<Frame caption={"a \\" b"} data-lightbox>'],
  ])('keeps %s around an embed whole, as main does', (_name, opener) => {
    const page = `Intro.\n\n${opener}\n  ${IFRAME}\n</Frame>\n\nOutro.`;
    const editor = open(page);
    expect(nodes(editor, 'videoEmbed')).toEqual([]);
    expect(nodes(editor, 'mdxOpaqueBlock').map(({ node }) => node.attrs.source)).toEqual([`${opener}\n  ${IFRAME}\n</Frame>`]);
    cycles(page);
  });

  it('reads a JSX string caption around an image as main does', () => {
    const page = 'Intro.\n\n<Frame caption={"Tour"}>\n\n![Diagram](/diagram.png)\n\n</Frame>\n\nOutro.';
    const editor = open(page);
    expect(nodes(editor, 'mdxFrame').map(({ node }) => node.attrs.caption)).toEqual(['{"Tour"}']);
    cycles(page);
  });

  it('edits a plain caption in place, keeping the other attributes', () => {
    const page = `Intro.\n\n<Frame caption="Tour" data-lightbox aria-label="Video">\n  ${IFRAME}\n</Frame>\n\nOutro.`;
    const editor = open(page);
    setAttributes(editor, 'videoEmbed', { caption: 'New tour' });
    expect(getMarkdown(editor)).toBe(page.replace('caption="Tour"', 'caption="New tour"'));
  });
});

describe('clearing or editing an attribute next to another', () => {
  it.each([
    ['a Card title after a boolean, before an attribute', 'Card', '<Card hidden title="Old"href="/docs">', '<Card hidden href="/docs">'],
    ['a Card title after an expression', 'Card', '<Card data-x={1}title="Old"href="/docs">', '<Card data-x={1} href="/docs">'],
    ['a Card title before a spread', 'Card', '<Card hidden title="Old"{...props}>', '<Card hidden {...props}>'],
    ['a Card title, last before >', 'Card', '<Card href="/docs"title="Old">', '<Card href="/docs">'],
    ['a Card title on its own line', 'Card', '<Card\n  title="Old"\n  href="/docs"\n>', '<Card\n  href="/docs"\n>'],
    ['a Frame caption ending in a backslash', 'Frame', '<Frame caption="Old\\"href="/docs">', '<Frame href="/docs">'],
  ])('%s: clearing keeps the other attributes apart, and an edit rewrites only the value', (_name, tag, opener, cleared) => {
    const type = tag === 'Card' ? 'mdxCard' : 'mdxFrame';
    const key = tag === 'Card' ? 'title' : 'caption';
    const body = tag === 'Card' ? '\n\nBody\n\n' : '\n\n![Diagram](/diagram.png)\n\n';
    const page = `Intro.\n\n${opener}${body}</${tag}>\n\nOutro.`;
    const old = opener.match(new RegExp(`${key}="Old\\\\?"`))?.[0] ?? '';

    const editor = open(page);
    setAttributes(editor, type, { [key]: '' });
    expect(getMarkdown(editor)).toBe(page.replace(opener, cleared));

    const edited = open(page);
    setAttributes(edited, type, { [key]: 'Edited' });
    expect(getMarkdown(edited)).toBe(page.replace(old, `${key}="Edited"`));
  });

  it('switches a boolean on next to another attribute without joining them', () => {
    const page = 'Intro.\n\n<Accordion defaultOpen={false}title="Old">\n\nBody\n\n</Accordion>\n\nOutro.';
    const editor = open(page);
    setAttributes(editor, 'mdxAccordion', { defaultOpen: true });
    expect(getMarkdown(editor)).toBe(page.replace('defaultOpen={false}title', 'defaultOpen title'));
  });
});
