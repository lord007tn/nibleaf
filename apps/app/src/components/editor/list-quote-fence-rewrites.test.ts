// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * Source rewrites of lists and fences:
 * - #638: a tight list holding a loose list was saved loose on the first save.
 * - #649: a paragraph added after an unclosed fence that ends its list item with
 *   whitespace lines was saved so that the blank line before it, and those
 *   whitespace lines, were read back as more of the fence's code.
 */

const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
afterAll(() => editor.destroy());

const save = (page: string) => {
  editor.commands.setContent(page, { emitUpdate: false });
  return getMarkdown(editor);
};

/** Ten load/save cycles, each giving the page back byte for byte. */
const expectTenIdenticalSaves = (page: string) => {
  let saved = page;
  for (let cycle = 0; cycle < 10; cycle++) {
    saved = save(saved);
    expect(saved).toBe(page);
  }
};

const LOCALES = [
  { locale: 'EN', a: 'Alpha', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot' },
  { locale: 'AR', a: 'أول', b: 'ثان', c: 'ثالث', d: 'رابع', e: 'خامس', f: 'سادس' },
] as const;

describe('a tight list holding a loose list stays tight (#638)', () => {
  for (const { locale, a, b, c, d, e, f } of LOCALES) {
    it(`saves the list nested one level byte for byte (${locale})`, () => {
      expectTenIdenticalSaves(`- ${a}\n  - ${b}\n\n  - ${c}\n- ${d}`);
      expectTenIdenticalSaves(`- ${a}\n  - ${b}\n\n    ${c}\n- ${d}`);
    });

    it(`saves the list nested two levels byte for byte (${locale})`, () => {
      expectTenIdenticalSaves(`- ${a}\n  - ${b}\n    - ${c}\n\n    - ${d}\n  - ${e}\n- ${f}`);
      expectTenIdenticalSaves(`1. ${a}\n   - ${b}\n     1. ${c}\n\n     2. ${d}\n   - ${e}\n2. ${f}`);
    });
  }
});

describe('a paragraph added after an unclosed fence stays out of its code (#649)', () => {
  const codes = () => {
    const found: string[] = [];
    editor.state.doc.descendants((node: PMNode) => {
      if (node.type.name === 'codeBlock') found.push(node.textContent);
    });
    return found;
  };
  const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'Appended' }] };

  /** Load `page`, add a paragraph at `position` (the end of the page by default),
   *  save, and reload: the code is as it was, and the paragraph is where it was added. */
  const expectCodeKept = (page: string, inQuote = false) => {
    editor.commands.setContent(page, { emitUpdate: false });
    const before = codes();
    const quote = editor.state.doc.firstChild as PMNode;
    editor.commands.insertContentAt(inQuote ? 1 + quote.content.size : editor.state.doc.content.size, paragraph);
    const saved = getMarkdown(editor);
    editor.commands.setContent(saved, { emitUpdate: false });
    expect(codes()).toEqual(before);
    const container = inQuote ? (editor.state.doc.firstChild as PMNode) : editor.state.doc;
    const last = container.lastChild?.textContent === '' ? container.child(container.childCount - 2) : container.lastChild;
    expect([last?.type.name, last?.textContent]).toEqual(['paragraph', 'Appended']);
    expect(save(saved)).toBe(saved);
  };

  it('keeps the code of a fence ending a list item, with whitespace lines after it', () => {
    expectCodeKept('- ~~~js\n  a\n   \n   ');
  });

  it('keeps the code of a fence ending a quoted list item, with a paragraph added in the quote', () => {
    expectCodeKept('> - ~~~js\n>   a\n>    \n>    ', true);
  });

  it('keeps the code of a fence ending a nested list item', () => {
    expectCodeKept('- Item\n  - ~~~js\n    a\n     \n     ');
    expectCodeKept('1. Item\n   - ~~~js\n     a\n      \n      ');
  });

  it('keeps the code of a fence ending a list item when the tight list gets a next item', () => {
    editor.commands.setContent('- ~~~js\n  a\n   \n   ', { emitUpdate: false });
    const before = codes();
    const list = editor.state.doc.firstChild as PMNode;
    editor.commands.insertContentAt(list.nodeSize - 1, { type: 'listItem', content: [paragraph] });
    const saved = getMarkdown(editor);
    editor.commands.setContent(saved, { emitUpdate: false });
    expect(codes()).toEqual(before);
    const reloaded = editor.state.doc.firstChild as PMNode;
    expect([reloaded.childCount, reloaded.lastChild?.textContent]).toEqual([2, 'Appended']);
    expect(save(saved)).toBe(saved);
  });

  // Regression guards, which main passes too: a fence that ends its quote is ended
  // by whatever follows the quote, and one with a block after it in its quote gets
  // a closing line.
  it('keeps the code of a fence ending a quote, with a paragraph added after or in the quote', () => {
    expectCodeKept('> ~~~js\n> a\n>   \n>   ');
    expectCodeKept('> ~~~js\n> a\n>   \n>   ', true);
  });

  // Regression guards, which main passes too: an unclosed fence that ends where it
  // did keeps its source.
  it('still saves an unclosed fence unchanged where nothing is added to its code', () => {
    expectTenIdenticalSaves('- ~~~js\n  a\n   \n   ');
    expectTenIdenticalSaves('- ~~~js\n  a\n\n- b');
    expectTenIdenticalSaves('- ~~~js\n  a\n- b');
    expectTenIdenticalSaves('> ~~~js\n> a\n\nAfter');
  });
});
