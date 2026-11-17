// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #606: a component's children that start on the line right after its opening tag,
 * with no blank line between, are Markdown, as the reader (MDX) reads them. The
 * editor's Markdown parser read the tag and those lines up to the first blank line
 * as one raw HTML block, so they were saved back as escaped text (`\- Item`). Now
 * they load as Markdown, and the component saves back byte for byte: its children
 * right after the tag, and its closing tag right after them, where the author wrote
 * them so, and a blank line where the author left one.
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

/** The first node named `type` in the page as the editor loads it. */
const firstNode = (page: string, type: string): PMNode | undefined => {
  let found: PMNode | undefined;
  open(page).state.doc.descendants((node) => {
    if (!found && node.type.name === type) found = node;
    return !found;
  });
  return found;
};

interface Language {
  item: string;
  second: string;
  heading: string;
  link: string;
  emphasis: string;
  more: string;
}
const LANGUAGES: Record<'en' | 'ar', Language> = {
  en: { item: 'Item', second: 'Item two', heading: 'Heading', link: 'the guide', emphasis: 'important', more: 'More text.' },
  // Arabic: "item", "second item", "heading", "the guide", "important", "more text."
  ar: {
    item: 'عنصر',
    second: 'عنصر ثان',
    heading: 'عنوان',
    link: 'الدليل',
    emphasis: 'مهم',
    more: 'نص آخر.',
  },
};

/** Each first child: its Markdown, and what the editor must read it as. */
const FIRST_CHILDREN: Record<string, { markdown: (words: Language) => string; reads: (component: PMNode) => boolean }> = {
  list: {
    markdown: (words) => `- ${words.item}\n- ${words.second}`,
    reads: (component) => component.firstChild?.type.name === 'bulletList' && component.firstChild.childCount === 2,
  },
  heading: {
    markdown: (words) => `## ${words.heading}`,
    reads: (component) => component.firstChild?.type.name === 'heading' && component.firstChild.attrs.level === 2,
  },
  link: {
    markdown: (words) => `[${words.link}](/docs/guide) ${words.item}`,
    reads: (component) => component.firstChild?.firstChild?.marks.some((mark) => mark.type.name === 'link') === true,
  },
  emphasis: {
    markdown: (words) => `*${words.emphasis}* ${words.item}`,
    reads: (component) => component.firstChild?.firstChild?.marks.some((mark) => mark.type.name === 'italic') === true,
  },
};

/** Each component: how a page holds it around `body`, and the node it loads as. */
const COMPONENTS: Record<string, { wrap: (body: string) => string; node: string }> = {
  Note: { wrap: (body) => `<Note>${body}</Note>`, node: 'callout' },
  Tip: { wrap: (body) => `<Tip>${body}</Tip>`, node: 'callout' },
  Warning: { wrap: (body) => `<Warning>${body}</Warning>`, node: 'callout' },
  Step: { wrap: (body) => `<Steps>\n\n<Step title="Install">${body}</Step>\n\n</Steps>`, node: 'mdxStep' },
  Accordion: { wrap: (body) => `<Accordion title="Details">${body}</Accordion>`, node: 'mdxAccordion' },
};

/** The blank lines after the opening tag and before the closing tag. */
const LAYOUTS = {
  'no blank lines': ['\n', '\n'],
  'blank lines around': ['\n\n', '\n\n'],
  'a blank line after the opening tag only': ['\n\n', '\n'],
  'a blank line before the closing tag only': ['\n', '\n\n'],
} as const;

describe('component children on the line after the opening tag (#606)', () => {
  for (const [component, { wrap, node }] of Object.entries(COMPONENTS)) {
    for (const [child, { markdown, reads }] of Object.entries(FIRST_CHILDREN)) {
      it(`<${component}> with a ${child} first: read as Markdown and saved byte for byte, in every layout, EN and AR`, () => {
        for (const words of Object.values(LANGUAGES)) {
          for (const [after, before] of Object.values(LAYOUTS)) {
            const page = `Intro.\n\n${wrap(`${after}${markdown(words)}\n\n${words.more}${before}`)}\n\nAfter.`;
            const loaded = firstNode(page, node);
            expect(loaded && reads(loaded), page).toBe(true);
            expectFourCycles(page);
          }
        }
      });
    }
  }

  it('the issue page: a list right after <Note> and text right before </Note>', () => {
    const page = '<Note>\n- Item\n- Item two\n\nMore text.\n</Note>';
    expect(firstNode(page, 'callout')?.firstChild?.type.name).toBe('bulletList');
    expectFourCycles(page);
  });

  it('a <CodeGroup> with a blank line after its opening tag and none before its closing tag gains no blank line', () => {
    expectFourCycles('<CodeGroup>\n\n```js title="a.js"\nconst a = 1;\n```\n</CodeGroup>');
  });

  it('a quote or a table as the first child, right after the tag', () => {
    expectFourCycles('<Note>\n> quoted\n</Note>');
    expectFourCycles('<Note>\n| A | B |\n| --- | --- |\n| 1 | 2 |\n</Note>');
  });

  it('a component right after a tag keeps its Markdown children; the tags between components are laid out as before', () => {
    // A tag touching another tag (`<Steps>⏎<Step>`) was never lost: it keeps main's
    // blank-line layout. The Markdown right after `<Step>` is what was lost.
    const steps = '<Steps>\n<Step title="One">\n- a\n</Step>\n</Steps>';
    expect(getMarkdown(open(steps))).toBe('<Steps>\n\n<Step title="One">\n- a\n</Step>\n\n</Steps>');
    expectFourCycles('<Steps>\n\n<Step title="One">\n- a\n</Step>\n\n</Steps>');
    expectFourCycles(`<Tabs>\n\n<Tab title="A">\n- ${LANGUAGES.ar.item}\n</Tab>\n\n</Tabs>`);
  });

  it('a component in a quote, and in a list item', () => {
    expect(firstNode('> <Note>\n> - Item\n> - Two\n> </Note>', 'callout')?.firstChild?.type.name).toBe('bulletList');
    expectFourCycles('- Item\n\n  <Note>\n  - x\n  - y\n  </Note>\n\n- Next');
    expectFourCycles(`- ${LANGUAGES.ar.item}\n\n  <Accordion title="A">\n  ## ${LANGUAGES.ar.heading}\n  </Accordion>\n\n- ${LANGUAGES.ar.second}`);
  });

  it('CRLF pages keep their line breaks', () => {
    expectFourCycles('<Note>\r\n- Item\r\n- Item two\r\n\r\nMore text.\r\n</Note>');
  });

  it('an edit inside the children keeps the layout', () => {
    const editor = open('<Note>\n- Item\n- Item two\n\nMore text.\n</Note>');
    editor.commands.setTextSelection(3);
    editor.commands.insertContent('!');
    expect(getMarkdown(editor)).toBe('<Note>\n- !Item\n- Item two\n\nMore text.\n</Note>');
  });
});
