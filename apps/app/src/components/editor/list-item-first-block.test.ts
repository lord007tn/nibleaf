// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const editors: Editor[] = [];
function open(source: string): Editor {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.commands.setContent(source, { emitUpdate: false });
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function stable(source: string): void {
  let saved = source;
  for (let cycle = 0; cycle < 4; cycle++) {
    saved = getMarkdown(open(saved));
    expect(saved).toBe(source);
  }
}

// Ignore empty schema paragraphs, source attributes and the editor's trailing paragraph;
// retain every nonempty block and every container, so flattening cannot pass as no text loss.
function shape(node: PMNode): unknown {
  if (node.type.name === 'paragraph' && node.content.size === 0) return null;
  const children: unknown[] = [];
  node.forEach((child) => {
    const value = shape(child);
    if (value !== null) children.push(value);
  });
  return node.isText ? node.text : { type: node.type.name, children };
}

const acceptance: Array<{ index: number; source: string }> = [];
const bodies = [
  '- Alpha\n  - Beta\n\n  - Charlie\n- Delta',
  '- Top\n  - > Alpha',
  '- Alpha\n\n- Beta',
  '> quoted\n>\n> more',
  '```js\nconst x = 1;\n```',
  '- ~~~js\n  >\n- b',
  '1. Alpha\n   - Beta\n\n   - Gamma\n2. Delta',
];
const indices = [0, 1, 2, 6, 7, 8, 12, 13, 14, 18, 19, 20, 72, 73, 74, 78, 79, 80];
let index = 0;
for (const body of bodies) {
  for (const tag of ['Note', 'Accordion title="A"']) {
    for (const layout of ['\n', '\n\n']) {
      for (const container of [0, 1, 2]) {
        let source = `<${tag}>${layout}${body}\n\nTail.${layout}</${tag.split(' ')[0]}>`;
        if (container === 1) source = source.split('\n').map((line) => `> ${line}`).join('\n');
        if (container === 2) source = `- Item\n\n${source.split('\n').map((line) => `  ${line}`).join('\n')}\n\n- Next`;
        if (indices.includes(index)) acceptance.push({ index, source });
        index++;
      }
    }
  }
}

describe('list items led by a block (#604, #865)', () => {
  it('keeps HTML and component-led items exactly as main saves them', () => {
    expect([
      '- <Note>\n\n  Text\n\n  </Note>\n\n- next',
      '- <Custom>\n\n  stuff\n\n  </Custom>\n\n- next',
      '- <div class="note">\n  <b>Bold</b>\n  </div>\n\nOutro.',
    ].map((source) => ({ source, saved: getMarkdown(open(source)) }))).toMatchInlineSnapshot();
  });
  it.each(acceptance)('#858 interaction case $index stays nested after deleting its first textblock, EN and AR', ({ source }) => {
    for (const page of [source, source.replace(/Alpha|Beta|Charlie|Delta|Top|Gamma|Tail|Item|Next/g, (word) => `عربي${word}`)]) {
      const editor = open(page);
      let component: { node: PMNode; pos: number } | undefined;
      editor.state.doc.descendants((node, pos) => {
        if (!component && node.attrs.sourceOpen && !node.isAtom) component = { node, pos };
      });
      if (!component) throw new Error('Missing component');
      let first: { node: PMNode; pos: number } | undefined;
      editor.state.doc.nodesBetween(component.pos + 1, component.pos + component.node.nodeSize - 1, (node, pos) => {
        if (!first && node.isTextblock) first = { node, pos };
      });
      if (!first) throw new Error('Missing textblock');
      editor.view.dispatch(editor.state.tr.delete(first.pos, first.pos + first.node.nodeSize));
      const saved = getMarkdown(editor);
      const reloaded = open(saved);
      expect(reloaded.state.doc.textContent).toBe(editor.state.doc.textContent);
      expect(shape(reloaded.state.doc)).toEqual(shape(editor.state.doc));
      stable(saved);
    }
  });

  it('keeps the #865 quote inside the nested item byte for byte', () => {
    const source = '- Top\n  - > Alpha';
    const editor = open(source);
    const parentTypes: string[] = [];
    editor.state.doc.descendants((node, _pos, parent) => {
      if (node.type.name === 'blockquote') parentTypes.push(parent?.type.name ?? '');
    });
    expect(parentTypes).toEqual(['listItem']);
    stable(source);
  });

  it.each(['> quoted', '## Heading', '- nested', '1. nested'])('keeps %s on the marker line in tight and loose lists', (block) => {
    for (const marker of ['- ', '1. ']) {
      for (const gap of ['\n', '\n\n']) {
        stable(`${marker}${block}${gap}${marker === '- ' ? '- ' : '2. '}${block}\n\nOutro.`);
      }
    }
  });

  it('keeps a following paragraph outside a quote-led item (the parked swallowing failure)', () => {
    const source = '- > quoted\n\n  Inside.\n\n- Next\n\nOutro.';
    const saved = getMarkdown(open(source));
    const reloaded = open(saved);
    expect(reloaded.state.doc.child(1).textContent).toBe('Outro.');
    expect(shape(reloaded.state.doc)).toEqual(shape(open(source).state.doc));
    stable(saved);
  });
});
