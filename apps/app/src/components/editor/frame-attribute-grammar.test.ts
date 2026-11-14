// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * Component openers read with the MDX grammar (#579). In MDX a quoted attribute
 * value has no backslash escapes: `caption="Old\"` is the caption `Old\`, and the
 * attributes after it are read as attributes. An opener the compiler rejects is
 * kept whole, children included, byte for byte; a wrapper is never dropped.
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

const nodes = (editor: Editor, type?: string) => {
  const found: Array<{ node: PMNode; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (!type || node.type.name === type) found.push({ node, pos });
  });
  return found;
};
const types = (editor: Editor) => nodes(editor).map(({ node }) => node.type.name);
const setAttributes = (editor: Editor, type: string, attributes: Record<string, unknown>) => {
  const target = nodes(editor, type)[0];
  if (!target) throw new Error(`No ${type}`);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, ...attributes }));
};
/** Load and save `cycles` times: every save is the page, byte for byte. */
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

  it('edits that caption in place and keeps the attribute after it', () => {
    const editor = open(ISSUE);
    setAttributes(editor, 'videoEmbed', { caption: 'New' });
    expect(getMarkdown(editor)).toBe(ISSUE.replace('caption="Old\\"', 'caption="New"'));
    // A caption the writer ends with a backslash saves as MDX reads it back.
    setAttributes(editor, 'videoEmbed', { caption: 'C:\\' });
    const saved = getMarkdown(editor);
    expect(saved).toBe(ISSUE.replace('caption="Old\\"', 'caption="C:\\"'));
    expect(nodes(open(saved), 'videoEmbed').map(({ node }) => node.attrs.caption)).toEqual(['C:\\']);
  });

  it.each([
    ['an embed', `<Frame caption="Old\\" data-lightbox>\n  ${IFRAME}\n</Frame>`, 'videoEmbed'],
    ['a video', '<Frame caption="Old\\" id="tour">\n  <video controls src="https://cdn.example.com/a.mp4"></video>\n</Frame>', 'videoEmbed'],
    ['an image', '<Frame caption="Old\\" data-lightbox>\n\n![Diagram](/diagram.png)\n\n</Frame>', 'mdxFrame'],
    ['an HTML image', '<Frame caption="Old\\" data-lightbox>\n\n<img src="/diagram.png" alt="Diagram" />\n\n</Frame>', 'mdxFrame'],
  ])('keeps a trailing-backslash caption and the attribute after it, with %s inside', (_name, page, type) => {
    const editor = open(`Intro.\n\n${page}\n\nOutro.`);
    expect(nodes(editor, type)).toHaveLength(1);
    expect(nodes(editor, type)[0]?.node.attrs.caption).toBe('Old\\');
    cycles(`Intro.\n\n${page}\n\nOutro.`);
    setAttributes(editor, type, { caption: 'Edited' });
    expect(getMarkdown(editor)).toBe(`Intro.\n\n${page.replace('caption="Old\\"', 'caption="Edited"')}\n\nOutro.`);
  });

  it('reads a Card title ending in a backslash, and edits only that title', () => {
    const page = 'Intro.\n\n<Card title="C:\\" href="/docs" data-x="1">\n\nBody\n\n</Card>';
    const editor = open(page);
    expect(nodes(editor, 'mdxCard')[0]?.node.attrs).toMatchObject({ title: 'C:\\', href: '/docs' });
    cycles(page);
    setAttributes(editor, 'mdxCard', { title: 'Edited' });
    expect(getMarkdown(editor)).toBe(page.replace('title="C:\\"', 'title="Edited"'));
  });
});

describe('the attribute forms MDX reads', () => {
  it.each([
    ['single quotes, a trailing backslash', "<Frame caption='Old\\' data-lightbox>", 'Old\\'],
    ['single quotes around double quotes', `<Frame caption='Say "hi"' data-lightbox>`, 'Say "hi"'],
    ['double quotes around an apostrophe', `<Frame caption="It's here" data-lightbox>`, "It's here"],
    ['a backslash before an apostrophe', '<Frame caption="It\\\'s" data-lightbox>', "It\\'s"],
    ['a > in the value', '<Frame caption="a > b" data-lightbox>', 'a > b'],
    ['a multiline opener', '<Frame\n  caption="Old\\"\n  data-lightbox\n  aria-label="Tour"\n>', 'Old\\'],
    ['spaces around =', '<Frame caption = "Old\\" data-lightbox>', 'Old\\'],
    ['no space between attributes', '<Frame caption="Old\\"data-lightbox>', 'Old\\'],
    ['data-*, aria-* and boolean attributes', '<Frame data-lightbox aria-label="Tour" caption="Old\\" hidden>', 'Old\\'],
    ['a spread after the caption', '<Frame caption="Old\\" {...props}>', 'Old\\'],
    ['a namespaced attribute', '<Frame xml:lang="en" caption="Old\\">', 'Old\\'],
  ])('opens %s around an embed as the block, and saves it unchanged', (_name, opener, caption) => {
    const page = `Intro.\n\n${opener}\n  ${IFRAME}\n</Frame>\n\nOutro.`;
    const editor = open(page);
    expect(nodes(editor, 'videoEmbed').map(({ node }) => node.attrs.caption)).toEqual([caption]);
    cycles(page);
  });

  it.each([
    ['a JSX string caption', '<Frame caption={"Tour"}>'],
    ['a JSX string caption with a brace and an escaped quote', '<Frame caption={"a } \\" b"} data-lightbox>'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the page's MDX holds a template literal.
    ['a template literal caption', '<Frame caption={`Tour ${1}`}>'],
  ])('keeps %s around an embed whole, as main does', (_name, opener) => {
    const page = `Intro.\n\n${opener}\n  ${IFRAME}\n</Frame>\n\nOutro.`;
    const editor = open(page);
    expect(nodes(editor, 'videoEmbed')).toEqual([]);
    expect(nodes(editor, 'mdxOpaqueBlock').map(({ node }) => node.attrs.source)).toEqual([`${opener}\n  ${IFRAME}\n</Frame>`]);
    cycles(page);
  });

  it('reads a JSX string caption around an image as main does, and saves it unchanged', () => {
    const page = 'Intro.\n\n<Frame caption={"Tour"}>\n\n![Diagram](/diagram.png)\n\n</Frame>\n\nOutro.';
    const editor = open(page);
    expect(nodes(editor, 'mdxFrame')[0]?.node.attrs.caption).toBe('{"Tour"}');
    cycles(page);
  });
});

describe('a blank line inside a value', () => {
  it.each([
    ['a quoted caption', '<Frame caption="Old\\\n\nnew" data-lightbox>', 'Old\\\n\nnew'],
    ['an expression caption with a comment', "<Frame caption={\n  'x' // } >\n\n  } data-lightbox>", "{\n  'x' // } >\n\n  }"],
  ])('keeps %s and the component, byte for byte', (_name, opener, caption) => {
    const page = `Intro.\n\n${opener}\n\n![Diagram](/diagram.png)\n\n</Frame>\n\nOutro.`;
    const editor = open(page);
    expect(nodes(editor, 'mdxFrame').map(({ node }) => node.attrs.caption)).toEqual([caption]);
    cycles(page);
  });
});

describe('openers the MDX compiler rejects', () => {
  it.each([
    ['an escaped quote read as JSX would not', `<Frame caption="a \\"b\\" c">\n  ${IFRAME}\n</Frame>`],
    ['an unquoted value', `<Frame caption=Tour>\n  ${IFRAME}\n</Frame>`],
    ['a member name as an attribute', '<Card title="A" a.b="x">\n\nBody\n\n</Card>'],
    ['an empty expression', '<Card title={}>\n\nBody\n\n</Card>'],
    ['a stray backslash between attributes', '<Frame caption="Old" \\ data-lightbox>\n\n![Diagram](/diagram.png)\n\n</Frame>'],
  ])('keeps %s whole, children included, byte for byte', (_name, component) => {
    const page = `Intro.\n\n${component}\n\nOutro.`;
    const editor = open(page);
    expect(types(editor)).not.toContain('mdxFrame');
    expect(types(editor)).not.toContain('mdxCard');
    expect(types(editor)).not.toContain('videoEmbed');
    expect(nodes(editor, 'mdxOpaqueBlock').map(({ node }) => node.attrs.source)).toEqual([component]);
    cycles(page);
  });

  it('keeps an opener whose value never closes, from its < to the end of the page', () => {
    const page = `Intro.\n\n<Frame caption="Old data-lightbox>\n  <iframe src=x></iframe>\n</Frame>\n\nOutro.`;
    const editor = open(page);
    expect(nodes(editor, 'mdxOpaqueBlock').map(({ node }) => node.attrs.source)).toEqual([page.slice(page.indexOf('<Frame'))]);
    expect(types(editor)).toContain('paragraph');
    cycles(page);
  });
});
