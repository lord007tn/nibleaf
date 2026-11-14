// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * Code fences inside list items and quotes keep their source when a page is loaded
 * and saved. A fence that opened on its list item's first line (`- ```html`) used
 * to move out of the list (#578), and a quoted fence straight inside a
 * `<CodeGroup>` collapsed into one escaped paragraph (#589).
 */

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

/** Four load/save cycles, each giving the page back byte for byte. */
const expectFourIdenticalSaves = (page: string) => {
  let saved = page;
  for (let cycle = 0; cycle < 4; cycle++) {
    saved = getMarkdown(open(saved));
    expect(saved).toBe(page);
  }
};

/** Each code block's text and the node it sits in. */
const codeBlocks = (page: string) => {
  const blocks: Array<{ parent: string; code: string }> = [];
  open(page).state.doc.descendants((node, _pos, parent) => {
    if (node.type.name === 'codeBlock') blocks.push({ parent: parent?.type.name ?? '', code: node.textContent });
  });
  return blocks;
};

const LOCALES = [
  { locale: 'EN', before: 'Intro.', after: 'Outro.', next: 'Next' },
  { locale: 'AR', before: 'مقدمة الصفحة.', after: 'خاتمة الصفحة.', next: 'التالي' },
] as const;

const IFRAME = '<iframe src="x"></iframe>';

describe('a code fence on a list item’s first line (#578)', () => {
  const variants: Array<[name: string, block: (next: string) => string, code: string]> = [
    ['a bullet item', (next) => `- \`\`\`html\n  ${IFRAME}\n  \`\`\`\n- ${next}`, IFRAME],
    ['an ordered item', (next) => `1. \`\`\`js\n   const a = 1;\n   \`\`\`\n2. ${next}`, 'const a = 1;'],
    ['a nested item', (next) => `- Outer\n\n  - \`\`\`html\n    ${IFRAME}\n    \`\`\`\n  - ${next}`, IFRAME],
    ['an item in a blockquote', (next) => `> - \`\`\`html\n>   ${IFRAME}\n>   \`\`\`\n> - ${next}`, IFRAME],
    ['an item in a blockquote, a tab after `>`', (next) => `> - \`\`\`html\n>\t${IFRAME}\n>\t\`\`\`\n> - ${next}`, IFRAME],
    // A tab is four columns: two are the item's indent, two are the code's.
    ['a bullet item, tab-indented continuation lines', (next) => `- \`\`\`html\n\t${IFRAME}\n\t\`\`\`\n- ${next}`, `  ${IFRAME}`],
    ['an ordered item, tab-indented continuation lines', (next) => `1. \`\`\`js\n\tconst a = 1;\n\t\`\`\`\n2. ${next}`, ' const a = 1;'],
    ['a bullet item, a longer closer', (next) => `- \`\`\`html\n  ${IFRAME}\n  \`\`\`\`\`\n- ${next}`, IFRAME],
    ['a bullet item, text after the closing fence', (next) => `- \`\`\`html\n  ${IFRAME}\n  \`\`\`\n\n  After the code.\n\n- ${next}`, IFRAME],
  ];

  for (const { locale, before, after, next } of LOCALES) {
    it.each(variants)(`keeps the fence in %s, byte for byte over four saves (${locale})`, (_name, block, code) => {
      const page = `${before}\n\n${block(next)}\n\n${after}`;
      expectFourIdenticalSaves(page);
      expect(codeBlocks(page)).toEqual([{ parent: 'listItem', code }]);
    });
  }

  it('keeps a code block a writer puts under an empty list item in that item', () => {
    // An item with no text and a code block saves the fence on the item's line;
    // `- ` and a blank line before it would end the item (CommonMark).
    const editor = open('');
    const code = { type: 'codeBlock', content: [{ type: 'text', text: 'const a = 1;' }] };
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }, code] }] }],
    });
    const saved = getMarkdown(editor);
    expect(saved).toBe('- ```\n  const a = 1;\n  ```');
    expect(codeBlocks(saved)).toEqual([{ parent: 'listItem', code: 'const a = 1;' }]);
    expectFourIdenticalSaves(saved);
  });
});

describe('a quoted fence straight inside <CodeGroup> (#589)', () => {
  const TOUR = '[Tour](https://youtu.be/abcdefghijk)';
  const variants: Array<[name: string, block: string]> = [
    ['a tab after `>`, closed with four backticks', `<CodeGroup>\n>\t\`\`\`md\n>\t${TOUR}\n>\t\`\`\`\`\n</CodeGroup>`],
    ['a space after `>`', `<CodeGroup>\n> \`\`\`md\n> ${TOUR}\n> \`\`\`\`\n</CodeGroup>`],
    ['no space after `>`', `<CodeGroup>\n>\`\`\`md\n>${TOUR}\n>\`\`\`\`\n</CodeGroup>`],
    ['a longer closer', `<CodeGroup>\n>\t\`\`\`md\n>\t${TOUR}\n>\t\`\`\`\`\`\`\n</CodeGroup>`],
    ['a fence in a list item instead of a quote', `<CodeGroup>\n- \`\`\`md\n  ${TOUR}\n  \`\`\`\`\n</CodeGroup>`],
    ['a fence with no container', `<CodeGroup>\n\`\`\`md\n${TOUR}\n\`\`\`\n</CodeGroup>`],
    ['component markup in the quoted code', `<CodeGroup>\n>\t\`\`\`jsx\n>\t<Card title="x" />\n>\t\`\`\`\`\n</CodeGroup>`],
  ];

  for (const { locale, before, after } of LOCALES) {
    it.each(variants)(`keeps %s byte for byte over four saves (${locale})`, (_name, block) => {
      expectFourIdenticalSaves(`${before}\n\n${block}\n\n${after}`);
    });

    it.each(variants)(`leaves %s unchanged when the paragraph next to it is edited (${locale})`, (_name, block) => {
      const editor = open(`${before}\n\n${block}\n\n${after}`);
      editor.commands.setTextSelection(3);
      editor.commands.insertContent('!');
      expect(getMarkdown(editor)).toBe(`${before.slice(0, 2)}!${before.slice(2)}\n\n${block}\n\n${after}`);
    });
  }
});
