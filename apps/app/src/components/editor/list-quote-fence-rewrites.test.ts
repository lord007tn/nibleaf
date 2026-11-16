// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * First-save rewrites of lists, quotes and fences:
 * - #605: a tight list item with a fence and text after it was saved loose.
 * - #638: a tight list holding a loose list was saved loose, and a quote's lazy
 *   continuation line (no `>`) was saved with a `>` added.
 * - #649: a paragraph added after an unclosed fence that ends its list item was
 *   saved so that the blank line before it, and the whitespace lines kept after
 *   the fence, were read back as more of the fence's code.
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
  { locale: 'EN', step: 'Step:', after: 'After.', next: 'Next', a: 'Alpha', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot' },
  { locale: 'AR', step: 'الخطوة:', after: 'بعد ذلك.', next: 'التالي', a: 'أول', b: 'ثان', c: 'ثالث', d: 'رابع', e: 'خامس', f: 'سادس' },
] as const;

describe('a tight list item with a fence and text after it stays tight (#605)', () => {
  for (const { locale, step, after, next } of LOCALES) {
    it(`saves the bullet item byte for byte (${locale})`, () => {
      expectTenIdenticalSaves(`- ${step}\n  \`\`\`sh\n  npm i\n  \`\`\`\n  ${after}\n- ${next}`);
    });

    it(`saves the ordered item byte for byte (${locale})`, () => {
      expectTenIdenticalSaves(`1. ${step}\n   \`\`\`sh\n   npm i\n   \`\`\`\n   ${after}\n2. ${next}`);
    });

    it(`saves the item nested in another list byte for byte (${locale})`, () => {
      expectTenIdenticalSaves(`- ${next}\n  - ${step}\n    ~~~sh\n    npm i\n    ~~~\n    ${after}\n  - ${next}\n- ${next}`);
    });
  }

  // A regression guard, which main passes too: the loose form keeps its blank lines.
  it('keeps the blank lines of the loose form', () => {
    expectTenIdenticalSaves('- Step:\n\n  ```sh\n  npm i\n  ```\n\n  After.\n\n- Next');
  });
});

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

describe('a lazy quote continuation keeps its line (#638)', () => {
  for (const { locale, a, b, c } of LOCALES) {
    for (const [name, lineBreak] of [
      ['a soft break', '\n'],
      ['a backslash hard break', '\\\n'],
      ['a trailing-space hard break', '  \n'],
    ] as const) {
      it(`saves a quote's lazy line after ${name} byte for byte (${locale})`, () => {
        expectTenIdenticalSaves(`> ${a}${lineBreak}${b}`);
        expectTenIdenticalSaves(`> ${a}${lineBreak}${b}\n\n${c}`);
      });

      it(`saves a nested quote's lazy line after ${name} byte for byte (${locale})`, () => {
        expectTenIdenticalSaves(`> > ${a}${lineBreak}${b}`);
        expectTenIdenticalSaves(`> > ${a}${lineBreak}> ${b}${lineBreak}${c}`);
      });
    }
  }

  // Regression guards, which main passes too: the kept lines give way to the
  // canonical ones once they no longer say the same thing in the same place.
  it('writes the canonical lines once the paragraph is edited', () => {
    editor.commands.setContent('> Alpha\nBravo', { emitUpdate: false });
    editor.commands.insertContentAt(3, 'X');
    expect(getMarkdown(editor)).toBe('> AXlpha Bravo');
  });

  it('writes the canonical lines once the quote is in another container', () => {
    editor.commands.setContent('> Alpha\nBravo', { emitUpdate: false });
    editor.chain().setTextSelection(3).wrapInList('bulletList').run();
    const saved = getMarkdown(editor);
    expect(saved).not.toContain('\nBravo');
    expect(save(saved)).toBe(saved);
  });
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

  it('keeps the code of a fence with no whitespace after it', () => {
    expectCodeKept('- ~~~js\n  a');
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
