// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #714, phase 0a: a component opening tag whose `{…}` attribute holds a regular
 * expression with a quote in it, a comment with a `}` in it, or that never closes
 * its quote or brace. The pages are the probe's, byte for byte. Main read a quote
 * inside `/"/` as a string, so it read no tag at all: the opener was saved as
 * escaped text (`&lt;Card`) and its closing tag dropped, and a page the MDX
 * compiler accepted no longer compiled. Where the expression can be read (a
 * regular expression, a comment) the component stays editable; where its opener
 * can't be (an unterminated quote or brace), it is kept byte for byte, its
 * closing tag with it, and nothing after that closing tag is taken into it.
 */

const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
afterAll(() => editor.destroy());

/** Load a page; its top-level node types, and the first node with `key` and where it is. */
const load = (source: string, key?: string) => {
  editor.commands.setContent(source, { emitUpdate: false });
  const nodes: string[] = [];
  editor.state.doc.forEach((node) => {
    nodes.push(node.type.name);
  });
  let target: { pos: number; type: string; attrs: Record<string, unknown> } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (!target && key && key in node.attrs) target = { pos, type: node.type.name, attrs: node.attrs };
    return !target;
  });
  return { nodes, target };
};

/** Save the page unchanged, then load that save and save it again. */
const saveTwice = (source: string): [string, string] => {
  load(source);
  const first = getMarkdown(editor);
  load(first);
  return [first, getMarkdown(editor)];
};

const setAttribute = (source: string, key: string, value: string): string => {
  const { target } = load(source, key);
  if (!target) throw new Error(`no node with ${key}`);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, [key]: value }));
  return getMarkdown(editor);
};

/** Append text to the end of the first text block whose text is `text`. */
const appendTo = (source: string, text: string, added: string): string => {
  load(source);
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === text) at = pos + node.nodeSize - 1;
    return at < 0;
  });
  if (at < 0) throw new Error(`no text block ${text}`);
  editor.view.dispatch(editor.state.tr.insertText(added, at));
  return getMarkdown(editor);
};

// The three expressions from #695 (probe cases P-<Component>-10, -11 and -12).
const EXPRESSIONS = ['() => { return /"}/.test(s); }', "[1, /'/]", '() => { if (a) /x"/.test(b); }'] as const;
const COMPONENTS = [
  ['Card', 'title', 'mdxCard', 'Body'],
  ['Step', 'title', 'mdxStep', 'Body'],
  ['Accordion', 'title', 'mdxAccordion', 'Body'],
  ['Frame', 'caption', 'mdxFrame', '![Diagram](/diagram.png)'],
] as const;
const probePages = COMPONENTS.flatMap(([tag, key, type, body]) =>
  EXPRESSIONS.map((expression, index) => ({
    id: `P-${tag}-${10 + index}`,
    tag,
    key,
    type,
    expression,
    source: `Intro.\n\n<${tag} ${key}="Tour" data-extra={${expression}} data-keep="yes">\n\n${body}\n\n</${tag}>\n\nOutro.`,
  })),
);

describe('a regular expression with a quote in an attribute expression (#714)', () => {
  it.each(probePages)('$id saves unchanged, byte for byte, and stays editable', ({ source, key, type }) => {
    const { nodes, target } = load(source, key);
    expect(nodes).toEqual(['paragraph', type, 'paragraph']);
    expect(target?.attrs[key]).toBe('Tour');
    expect(saveTwice(source)).toEqual([source, source]);
  });

  it.each(probePages)('$id rewrites only the edited attribute', ({ source, tag, key, expression, type }) => {
    const edited = setAttribute(source, key, 'Edited');
    expect(edited).toBe(source.replace(`<${tag} ${key}="Tour"`, `<${tag} ${key}="Edited"`));
    expect(edited).toContain(`data-extra={${expression}} data-keep="yes">`);
    expect(load(edited, key).target?.type).toBe(type);
  });

  const d07 = '<Card title="Tour" data-extra={/"/} data-keep="yes">\n\nBody\n\n</Card>\n\n# After';
  it('D07 saves unchanged, byte for byte, and keeps its closing tag after a body edit', () => {
    expect(load(d07, 'title').target?.type).toBe('mdxCard');
    expect(saveTwice(d07)).toEqual([d07, d07]);
    expect(appendTo(d07, 'Body', '!')).toBe(d07.replace('Body', 'Body!'));
  });

  it('a self-closing <Card x={/"/} /> saves unchanged', () => {
    const page = '<Card x={/"/} />';
    expect(load(page).nodes[0]).toBe('mdxCard');
    expect(saveTwice(page)).toEqual([page, page]);
  });

  it('<Card x={/"/}>B</Card> is read as a Card, not escaped into text', () => {
    const page = '<Card x={/"/}>B</Card>';
    // The body moves to its own lines, as it does for any attribute (`<Card x="a">B</Card>`).
    const plain = saveTwice('<Card x="a">B</Card>')[0];
    expect(load(page).nodes[0]).toBe('mdxCard');
    const [first, second] = saveTwice(page);
    expect(first).toBe(plain.replace('x="a"', 'x={/"/}'));
    expect(first).not.toContain('&lt;');
    expect(second).toBe(first);
  });
});

describe('a comment with a `}` in an attribute expression (#714)', () => {
  const page = '<Card title={1 /* } */} icon="x">\n\nB\n\n</Card>';

  it('saves unchanged, and replaces the whole expression when the title is edited', () => {
    expect(saveTwice(page)).toEqual([page, page]);
    expect(setAttribute(page, 'title', 'Edited')).toBe('<Card title="Edited" icon="x">\n\nB\n\n</Card>');
  });

  it('removes the whole expression when the title is cleared', () => {
    expect(setAttribute(page, 'title', '')).toBe('<Card icon="x">\n\nB\n\n</Card>');
  });

  it('reads a `//` comment to the end of its line', () => {
    const lineComment = '<Card title={1 // }\n} icon="x">\n\nB\n\n</Card>';
    expect(saveTwice(lineComment)).toEqual([lineComment, lineComment]);
    expect(setAttribute(lineComment, 'title', 'Edited')).toBe('<Card title="Edited" icon="x">\n\nB\n\n</Card>');
  });
});

describe('an opening tag that never closes its quote or brace (#714)', () => {
  const d15 = '<Card title="oops>\n\nBody\n\n</Card>\n\n# After\n\n<Step />';
  const d16 = '<Card title={oops>\n\nBody\n\n</Card>\n\n# After\n\n<Step />';

  it.each([
    ['D15, an unterminated quote', d15],
    ['D16, an unterminated brace', d16],
  ])('%s keeps the opener and its closing tag, and nothing after them', (_label, page) => {
    expect(saveTwice(page)).toEqual([page, page]);
    // The heading and the Step after the closing tag are still the page's own.
    expect(load(page).nodes.slice(-3)).toEqual(['heading', 'mdxStep', 'paragraph']);
    expect(appendTo(page, 'After', '!')).toBe(page.replace('# After', '# After!'));
  });

  it.each([
    ['an unterminated quote', '<Card title=">'],
    ['an unterminated brace', '<Card title={>'],
  ])('a lone opener with %s saves unchanged', (_label, page) => {
    expect(saveTwice(page)).toEqual([page, page]);
  });
});
