// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #714, phase 0b: how a component's opening tag is written back when one of its
 * attributes is set or cleared. The pages are the probe's, byte for byte, and each saves
 * unchanged before its edit. Main took a boolean attribute's following space as part of
 * it, so a value set on it touched the next attribute; it trimmed the authored line break
 * before an attribute it removed; and it added a field to `<Card / >` after its `/`, so
 * the tag stopped being self-closing and was given a closing tag.
 */

const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
afterAll(() => editor.destroy());

/** Load a page; the first node with `key`, and where it is. */
const load = (source: string, key?: string) => {
  editor.commands.setContent(source, { emitUpdate: false });
  let target: { pos: number; attrs: Record<string, unknown> } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (!target && key && key in node.attrs) target = { pos, attrs: node.attrs };
    return !target;
  });
  return target;
};

/** Save the page unchanged, then load that save and save it again. */
const saveTwice = (source: string): [string, string] => {
  load(source);
  const first = getMarkdown(editor);
  load(first);
  return [first, getMarkdown(editor)];
};

const setAttribute = (source: string, key: string, value: string): string => {
  const target = load(source, key);
  if (!target) throw new Error(`no node with ${key}`);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, [key]: value }));
  return getMarkdown(editor);
};

describe('a field cleared after an authored line break (#714)', () => {
  // A-<Component>-leading-trivia and M-clear-trivia.
  it.each([
    ['Card', 'title'],
    ['Step', 'title'],
    ['Accordion', 'title'],
    ['Frame', 'caption'],
  ] as const)('<%s\\n\\n %s="Tour"icon="keep"> keeps the line break when the field is cleared', (tag, key) => {
    const source = `<${tag}\n\n ${key}="Tour"icon="keep">\n\nBody\n\n</${tag}>\n\n# After`;
    expect(saveTwice(source)).toEqual([source, source]);
    expect(setAttribute(source, key, '')).toBe(`<${tag}\n\n icon="keep">\n\nBody\n\n</${tag}>\n\n# After`);
  });

  it('<Card\\n title="x"icon="y" /> keeps the line break when the title is cleared', () => {
    const source = '<Card\n title="x"icon="y" />';
    expect(saveTwice(source)).toEqual([source, source]);
    expect(setAttribute(source, 'title', '')).toBe('<Card\n icon="y" />');
  });
});

describe('a boolean attribute that is edited (#714)', () => {
  it('<Card title icon="x"> keeps the space before icon when the title is set', () => {
    const source = '<Card title icon="x">\n\nB\n\n</Card>';
    expect(saveTwice(source)).toEqual([source, source]);
    expect(setAttribute(source, 'title', 'Edited')).toBe('<Card title="Edited" icon="x">\n\nB\n\n</Card>');
  });
});

describe('a field added to a spaced self-closing tag (#714)', () => {
  it('<Card / > gains the field before its `/ >` and stays self-closing', () => {
    const source = '<Card / >';
    expect(saveTwice(source)).toEqual([source, source]);
    expect(setAttribute(source, 'title', 'Edited')).toBe('<Card  title="Edited"/ >');
  });
});
