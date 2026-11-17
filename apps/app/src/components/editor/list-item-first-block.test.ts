// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from '@/components/markdown';
import { applyCorpusEdits, type DifferentialEditor, serializerCorpus } from './__fixtures__/serializer-corpus';
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
const arabic: Record<string, string> = {
  Alpha: 'ألف', Beta: 'باء', Charlie: 'جيم', Delta: 'دال', Top: 'أعلى', Gamma: 'جيم', Tail: 'نهاية', Item: 'عنصر', Next: 'التالي',
};
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
  // #871 owns HTML/component-led items; their load and save must remain main's
  // until Lane A teaches mdx-roundtrip.ts's separateBlock about an item lead.
  it('keeps HTML and component-led items exactly as main saves them', () => {
    expect([
      '- <Note>\n\n  Text\n\n  </Note>\n\n- next',
      '- <Custom>\n\n  stuff\n\n  </Custom>\n\n- next',
      '- <Accordion title="A">\n\n  Text\n\n  </Accordion>\n\n- next',
      '- <div class="note">\n  <b>Bold</b>\n  </div>\n\nOutro.',
    ].flatMap((source) => [
      source,
      source.split('\n').map((line) => `> ${line}`).join('\n'),
      `1. Item\n\n${source.split('\n').map((line) => `   ${line}`).join('\n')}\n\n2. Next`,
    ]).map((source) => ({ source, saved: getMarkdown(open(source)) }))).toMatchInlineSnapshot(`
      [
        {
          "saved": "- 

      <Note>

      Text

      </Note>

      - next",
          "source": "- <Note>

        Text

        </Note>

      - next",
        },
        {
          "saved": "> - 
      >
      > <Note>
      >
      > Text
      >
      > </Note>
      >
      > - next",
          "source": "> - <Note>
      > 
      >   Text
      > 
      >   </Note>
      > 
      > - next",
        },
        {
          "saved": "1. Item

         - 

         <Note>

         Text

         </Note>

         - next

      2. Next",
          "source": "1. Item

         - <Note>
         
           Text
         
           </Note>
         
         - next

      2. Next",
        },
        {
          "saved": "- <Custom>

        stuff

        </Custom>

      - next",
          "source": "- <Custom>

        stuff

        </Custom>

      - next",
        },
        {
          "saved": "> - <Custom>
      > 
      >   stuff
      > 
      >   </Custom>
      >
      > - next",
          "source": "> - <Custom>
      > 
      >   stuff
      > 
      >   </Custom>
      > 
      > - next",
        },
        {
          "saved": "1. Item

         - <Custom>
         
           stuff
         
           </Custom>

         - next

      2. Next",
          "source": "1. Item

         - <Custom>
         
           stuff
         
           </Custom>
         
         - next

      2. Next",
        },
        {
          "saved": "- 

      <Accordion title="A">

      Text

      </Accordion>

      - next",
          "source": "- <Accordion title="A">

        Text

        </Accordion>

      - next",
        },
        {
          "saved": "> - 
      >
      > <Accordion title="A">
      >
      > Text
      >
      > </Accordion>
      >
      > - next",
          "source": "> - <Accordion title="A">
      > 
      >   Text
      > 
      >   </Accordion>
      > 
      > - next",
        },
        {
          "saved": "1. Item

         - 

         <Accordion title="A">

         Text

         </Accordion>

         - next

      2. Next",
          "source": "1. Item

         - <Accordion title="A">
         
           Text
         
           </Accordion>
         
         - next

      2. Next",
        },
        {
          "saved": "- <div class="note">
        <b>Bold</b>
        </div>

      Outro.",
          "source": "- <div class="note">
        <b>Bold</b>
        </div>

      Outro.",
        },
        {
          "saved": "> - <div class="note">
      >   <b>Bold</b>
      >   </div>
      >
      > Outro.",
          "source": "> - <div class="note">
      >   <b>Bold</b>
      >   </div>
      > 
      > Outro.",
        },
        {
          "saved": "1. Item

         - <div class="note">
           <b>Bold</b>
           </div>

         Outro.

      2. Next",
          "source": "1. Item

         - <div class="note">
           <b>Bold</b>
           </div>
         
         Outro.

      2. Next",
        },
      ]
    `);
  });
  it.each(acceptance)('#858 interaction case $index stays nested after deleting its first textblock, EN and AR', ({ source }) => {
    for (const page of [source, source.replace(/Alpha|Beta|Charlie|Delta|Top|Gamma|Tail|Item|Next/g, (word) => arabic[word] ?? word)]) {
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

  it('the published reader keeps the #865 quote inside the same nested item', () => {
    const source = '- Top\n  - > Alpha';
    const render = (content: string) => renderToStaticMarkup(createElement(Markdown, { content }));
    const html = render(source);
    expect(render(getMarkdown(open(source)))).toBe(html);
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('li > ul > li > blockquote')?.textContent?.trim()).toBe('Alpha');
  }, 30_000);

  it.each(['> quoted', '## Heading', '- nested', '1. nested'])('keeps %s on the marker line in tight and loose lists', (block) => {
    for (const marker of ['- ', '1. ']) {
      for (const gap of ['\n', '\n\n']) {
        stable(`${marker}${block}${gap}${marker === '- ' ? '- ' : '2. '}${block}\n\nOutro.`);
      }
    }
  });

  it('keeps a following paragraph outside a quote-led item', () => {
    const source = '- > quoted\n\n  Inside.\n\n- Next\n\nOutro.';
    const saved = getMarkdown(open(source));
    const reloaded = open(saved);
    expect(reloaded.state.doc.child(1).textContent).toBe('Outro.');
    expect(shape(reloaded.state.doc)).toEqual(shape(open(source).state.doc));
    stable(saved);
  });
});

// The actual parked-branch swallowing case is attribute-blank-line differential #27.
// Its HTML-led item stays main-equivalent here; #871 owns its existing attribute damage.
it('does not swallow Outro in the parked attribute differential case 27', () => {
  const source = "Intro.\n\n- <Update label=\"a\rb\" hidden>\n  \n  <Card title=\"Inner\n  line\">\n  \n  Inner text.\n  \n  </Card>\n  \n  </Update>\n\nOutro.";
  const saved = getMarkdown(open(source));
  expect(saved).toBe("Intro.\n\n- \n\n<Update label=\"a\n&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;b&quot;&gt;&lt;/p&gt;  &lt;div data-mdx=\" hidden>\n\nInner text.\n\n</Update>\n\nOutro.");
  const doc = open(saved).state.doc;
  expect(doc.lastChild?.type.name).toBe('paragraph');
  expect(doc.lastChild?.textContent).toBe('Outro.');
});

// These pages saved to fixed points on main, but the first version of #604's load
// rule made them unstable. They must stay stable even when a complex item is left
// on main's fitting path rather than repaired by the narrowly supported rule.
const mainFixedPages = [12, 23, 33, 62, 73, 78, 87, 210, 241, 283, 365, 401, 470, 476, 633, 666, 707, 772, 839, 861, 964];
const corpus = serializerCorpus();
it.each(mainFixedPages)('serializer page %i must not lose its main fixed point', (index) => {
  const page = corpus[index];
  if (!page) throw new Error(`Missing serializer page ${index}`);
  const editor = open(page.source);
  applyCorpusEdits(editor as unknown as DifferentialEditor, page.edits);
  stable(getMarkdown(editor));
});
