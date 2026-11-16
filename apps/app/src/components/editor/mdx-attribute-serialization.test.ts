// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #714, phase 0b: how a component's opening tag is written back when one of its
 * attributes is set or cleared, and how a quoted value with a backslash before its
 * closing quote is read. The pages are the probe's, byte for byte. Main read
 * `title="Tour\"` with JavaScript's backslash escapes, where MDX and the reader have
 * none (the title is `Tour\`), so it read no tag and escaped the component into text;
 * it took a boolean attribute's following space as part of it; it trimmed the authored
 * line break before an attribute it removed; and it added a field to `<Card / >` after
 * its `/`.
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

describe('a quoted value with a backslash before its closing quote (#714)', () => {
  // A-<Component>-backslash-adjacent. A Frame already read its values this way (#579).
  const pages = (['Card', 'Step', 'Accordion'] as const).map((tag) => ({
    tag,
    type: `mdx${tag}`,
    source: `<${tag} title="Tour\\"icon="keep">\n\nBody\n\n</${tag}>\n\n# After`,
  }));

  it.each(pages)('<$tag title="Tour\\"icon="keep"> saves unchanged and keeps the component after a body edit', ({ source, type }) => {
    const { nodes, target } = load(source, 'title');
    expect(nodes).toEqual([type, 'heading', 'paragraph']);
    expect(target?.attrs.title).toBe('Tour\\');
    expect(saveTwice(source)).toEqual([source, source]);
    expect(appendTo(source, 'Body', '!')).toBe(source.replace('Body', 'Body!'));
  });

  it.each(pages)('<$tag title="Tour\\"icon="keep"> rewrites only the title when it is edited', ({ tag, source }) => {
    expect(setAttribute(source, 'title', 'Edited')).toBe(source.replace(`<${tag} title="Tour\\"`, `<${tag} title="Edited"`));
  });
});

describe('a field cleared after an authored line break (#714)', () => {
  // A-<Component>-leading-trivia and M-clear-trivia.
  it.each([
    ['Card', 'title'],
    ['Step', 'title'],
    ['Accordion', 'title'],
    ['Frame', 'caption'],
  ] as const)('<%s\\n\\n %s="Tour"icon="keep"> keeps the line break when the field is cleared', (tag, key) => {
    const source = `<${tag}\n\n ${key}="Tour"icon="keep">\n\nBody\n\n</${tag}>\n\n# After`;
    expect(setAttribute(source, key, '')).toBe(`<${tag}\n\n icon="keep">\n\nBody\n\n</${tag}>\n\n# After`);
  });

  it('<Card\\n title="x"icon="y" /> keeps the line break when the title is cleared', () => {
    expect(setAttribute('<Card\n title="x"icon="y" />', 'title', '')).toBe('<Card\n icon="y" />');
  });
});

describe('a boolean attribute that is edited (#714)', () => {
  it('<Card title icon="x"> keeps the space before icon when the title is set', () => {
    expect(setAttribute('<Card title icon="x">\n\nB\n\n</Card>', 'title', 'Edited')).toBe('<Card title="Edited" icon="x">\n\nB\n\n</Card>');
  });
});

describe('a field added to a spaced self-closing tag (#714)', () => {
  it('<Card / > gains the field before its `/ >` and stays self-closing', () => {
    expect(setAttribute('<Card / >', 'title', 'Edited')).toBe('<Card  title="Edited"/ >');
  });
});
