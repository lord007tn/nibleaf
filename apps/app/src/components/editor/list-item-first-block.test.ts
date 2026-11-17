// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #604: a list item whose first block is a quote, a heading, a nested list or a
 * component, on the item's first line (`- > quoted`), escaped its list on save:
 * the editor's list item starts with a paragraph, and the block was moved out of
 * the list. As #601 did for a fence there (#578), such a block now gets an empty
 * paragraph before it on load, which the save leaves out again, and the item saves
 * back byte for byte.
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
const expectFourCycles = (page: string) => {
  const saves: string[] = [];
  let current = page;
  for (let cycle = 0; cycle < 4; cycle++) {
    current = getMarkdown(open(current));
    saves.push(current);
  }
  expect(saves).toEqual([page, page, page, page]);
};

/** The names of the top-level nodes and of the first list's items' children. */
const shape = (page: string): { top: string[]; items: string[][] } => {
  const { doc } = open(page).state;
  let list: PMNode | undefined;
  doc.descendants((node) => {
    if (!list && (node.type.name === 'bulletList' || node.type.name === 'orderedList')) list = node;
    return !list;
  });
  const items: string[][] = [];
  list?.forEach((item) => {
    const children: string[] = [];
    item.forEach((child) => {
      children.push(child.type.name);
    });
    items.push(children);
  });
  const top: string[] = [];
  doc.forEach((node) => {
    top.push(node.type.name);
  });
  return { top, items };
};

const WORDS = {
  en: { quoted: 'quoted', heading: 'Heading', nested: 'nested', more: 'more', text: 'Text' },
  // Arabic: "quoted", "heading", "nested", "more", "text".
  ar: {
    quoted: 'اقتباس',
    heading: 'عنوان',
    nested: 'متداخل',
    more: 'المزيد',
    text: 'نص',
  },
};
type Words = (typeof WORDS)['en'];

/** Each first block: its Markdown after the item's marker, its continuation lines
 *  (indented by `indent`), and the node it loads as after the item's lead paragraph. */
const FIRST_BLOCKS: Record<string, { item: (words: Words, indent: string) => string; node: string }> = {
  quote: { item: (words) => `> ${words.quoted}`, node: 'blockquote' },
  'two-line quote': { item: (words, indent) => `> ${words.quoted}\n${indent}> ${words.more}`, node: 'blockquote' },
  heading: { item: (words) => `## ${words.heading}`, node: 'heading' },
  'nested bullet list': { item: (words, indent) => `- ${words.nested}\n${indent}- ${words.more}`, node: 'bulletList' },
  'nested ordered list': { item: (words, indent) => `1. ${words.nested}\n${indent}2. ${words.more}`, node: 'orderedList' },
};

/** A tight and a loose list of two such items, then a paragraph. */
const pages = (marker: (index: number) => string, block: (words: Words, indent: string) => string, words: Words): string[] => {
  const item = (index: number) => `${marker(index)}${block(words, ' '.repeat(marker(index).length))}`;
  return [`${item(1)}\n${item(2)}\n\n${words.text}.`, `${item(1)}\n\n${item(2)}\n\n${words.text}.`];
};

const MARKERS: Record<string, (index: number) => string> = {
  bullet: () => '- ',
  ordered: (index) => `${index}. `,
};

describe('a list item whose first block opens it on its first line (#604)', () => {
  for (const [name, { item, node }] of Object.entries(FIRST_BLOCKS)) {
    for (const [kind, marker] of Object.entries(MARKERS)) {
      it(`a ${kind} item opening with a ${name} stays in its list and saves byte for byte, tight and loose, EN and AR`, () => {
        for (const words of Object.values(WORDS)) {
          for (const page of pages(marker, item, words)) {
            const { top, items } = shape(page);
            expect(top, page).toEqual([kind === 'bullet' ? 'bulletList' : 'orderedList', 'paragraph']);
            expect(items, page).toEqual([
              ['paragraph', node],
              ['paragraph', node],
            ]);
            expectFourCycles(page);
          }
        }
      });
    }
  }

  it('the issue page: a quote, a heading and a nested list, each opening an item', () => {
    expect(shape('- > quoted\n- # Heading\n- - nested').top).toEqual(['bulletList', 'paragraph']);
    expectFourCycles('- > quoted\n- # Heading\n- - nested');
    expectFourCycles(`1. > ${WORDS.ar.quoted}\n2. ### ${WORDS.ar.heading}\n3. - ${WORDS.ar.nested}`);
  });

  it('in a nested list, after an item with text, and after text in its own item', () => {
    expectFourCycles('- a\n  - > deep\n  - # deep\n- b');
    expectFourCycles(`- ${WORDS.ar.text}\n  1. > ${WORDS.ar.quoted}\n  2. - ${WORDS.ar.nested}`);
    expectFourCycles('- text\n- > quoted\n- ## Heading');
    expectFourCycles('- > quote\n\n  A paragraph after it.\n\n- next');
  });

  it('inside a quote', () => {
    expect(shape('> - > quoted\n> - # Heading').top).toEqual(['blockquote', 'paragraph']);
    expectFourCycles('> - > quoted\n> - # Heading');
    expectFourCycles(`> 1. - ${WORDS.ar.nested}\n>    - ${WORDS.ar.more}\n> 2. > ${WORDS.ar.quoted}`);
  });

  it('a component or a block kept as source opening the item', () => {
    expect(shape('- <Note>\n\n  Text\n\n  </Note>\n\n- next').items[0]).toEqual(['paragraph', 'callout']);
    expectFourCycles('- <Note>\n\n  Text\n\n  </Note>\n\n- next');
    expectFourCycles(`1. <Accordion title="A">\n\n   - ${WORDS.ar.text}\n\n   </Accordion>\n\n2. next`);
    expectFourCycles('- <Steps>\n\n  <Step title="A">\n\n  Do it.\n\n  </Step>\n\n  </Steps>\n\n- next');
    expectFourCycles('- <Custom>\n\n  stuff\n\n  </Custom>\n\n- next');
    expectFourCycles(`- <Callout type="info">\n\n  - ${WORDS.ar.text}\n\n  </Callout>\n- next`);
  });

  it('a table opening the item', () => {
    expect(shape('10. | b | c |\n    | --- | --- |\n    | 1 | 2 |\n11. next').items[0]).toEqual(['paragraph', 'table']);
    expectFourCycles('10. | b | c |\n    | --- | --- |\n    | 1 | 2 |\n11. next');
    expectFourCycles(`- | ${WORDS.ar.text} |\n  | --- |\n  | 1 |\n- ${WORDS.ar.more}`);
  });

  it('a heading and then text in an item saves once with a blank line between them, and stays there', () => {
    // The editor writes an item's blocks blank-line apart; the items stay as close as they were.
    const saved = getMarkdown(open('- # H\n  text\n- b'));
    expect(saved).toBe('- # H\n\n  text\n- b');
    expectFourCycles(saved);
  });
});
