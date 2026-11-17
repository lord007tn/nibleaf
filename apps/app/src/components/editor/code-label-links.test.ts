// @vitest-environment jsdom
/**
 * #660: a link whose label is inline code, ``[`command`](/missing)``, lost the
 * link on load and save, and a label mixing text and code split into one link
 * per text run. TipTap's Code mark excluded every other mark, the link
 * included. The label must come back byte for byte and stay one link in the
 * editor, with both marks on its code, in a paragraph, a list, a quote and a
 * table, in English and in Arabic. Inline code outside a link, links without
 * code, and the other marks around code save as they did before.
 */
import { Editor, getSchema } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const editors = {
  en: new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ dir: 'ltr', locale: 'en' }) }),
  ar: new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ dir: 'rtl', locale: 'ar' }) }),
};

afterAll(() => {
  editors.en.destroy();
  editors.ar.destroy();
});

type Locale = keyof typeof editors;

const load = (editor: Editor, markdown: string) => editor.commands.setContent(markdown, { emitUpdate: false });

/** Load and save `markdown` ten times, returning each save. */
const tenSaves = (editor: Editor, markdown: string): string[] => {
  const saves: string[] = [];
  let current = markdown;
  for (let cycle = 0; cycle < 10; cycle += 1) {
    load(editor, current);
    current = getMarkdown(editor);
    saves.push(current);
  }
  return saves;
};

/** The text nodes of the editor's document, in order. */
const textNodes = (editor: Editor): PMNode[] => {
  const nodes: PMNode[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText) nodes.push(node);
  });
  return nodes;
};

const hrefOf = (node: PMNode) => node.marks.find((mark) => mark.type.name === 'link')?.attrs.href as string | undefined;
const isCode = (node: PMNode) => node.marks.some((mark) => mark.type.name === 'code');

const labels: Record<Locale, { name: string; label: string; text: string; code: string[] }[]> = {
  en: [
    { name: 'a label that is only code', label: '`command`', text: 'command', code: ['command'] },
    { name: 'text around code', label: 'run `npm i` now', text: 'run npm i now', code: ['npm i'] },
    { name: 'two code spans', label: 'run `npm i` then `npm test`', text: 'run npm i then npm test', code: ['npm i', 'npm test'] },
  ],
  ar: [
    { name: 'a label that is only code', label: '`الأمر`', text: 'الأمر', code: ['الأمر'] },
    { name: 'text around code', label: 'شغّل `npm i` الآن', text: 'شغّل npm i الآن', code: ['npm i'] },
    { name: 'two code spans', label: 'شغّل `npm i` ثم `npm test`', text: 'شغّل npm i ثم npm test', code: ['npm i', 'npm test'] },
  ],
};

/** Documents already in the form the editor saves, so one save must equal the source. */
const contexts: Record<Locale, { name: string; wrap: (link: string) => string }[]> = {
  en: [
    { name: 'paragraph', wrap: (link) => `See ${link} for setup.` },
    { name: 'list', wrap: (link) => `- See ${link} for setup.\n- Then deploy.` },
    { name: 'quote', wrap: (link) => `> See ${link} for setup.` },
    { name: 'table', wrap: (link) => `| Step | Command |\n| --- | --- |\n| Setup | ${link} |\n` },
  ],
  ar: [
    { name: 'paragraph', wrap: (link) => `راجع ${link} للإعداد.` },
    { name: 'list', wrap: (link) => `- راجع ${link} للإعداد.\n- ثم انشر.` },
    { name: 'quote', wrap: (link) => `> راجع ${link} للإعداد.` },
    { name: 'table', wrap: (link) => `| الخطوة | الأمر |\n| --- | --- |\n| الإعداد | ${link} |\n` },
  ],
};

describe('a link whose label holds inline code (#660)', () => {
  for (const locale of ['en', 'ar'] as const) {
    const editor = editors[locale];
    for (const { name, label, text, code } of labels[locale]) {
      for (const context of contexts[locale]) {
        const link = `[${label}](/guides/setup)`;
        const source = context.wrap(link);

        it(`${locale}: ${name} in a ${context.name} saves byte for byte over ten loads`, () => {
          expect(tenSaves(editor, source)).toEqual(Array.from({ length: 10 }, () => source));
        });

        it(`${locale}: ${name} in a ${context.name} stays one link, with its code marked as both`, () => {
          load(editor, source);
          const linked = textNodes(editor).filter((node) => hrefOf(node) !== undefined);
          expect(linked.map((node) => node.text).join('')).toBe(text);
          expect(linked.every((node) => hrefOf(node) === '/guides/setup')).toBe(true);
          expect(linked.filter(isCode).map((node) => node.text)).toEqual(code);
          expect(textNodes(editor).filter((node) => isCode(node) && hrefOf(node) === undefined)).toEqual([]);
        });
      }
    }
  }

  it('editing the link from inside its code changes the whole label', () => {
    const editor = editors.en;
    load(editor, 'See [run `npm i` now](/old) for setup.');
    // The caret inside `npm i`, as when a writer clicks the code to edit the link.
    const npm = textNodes(editor).find((node) => node.text === 'npm i');
    let caret = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node === npm) caret = pos + 2;
    });
    editor.chain().setTextSelection(caret).extendMarkRange('link').setLink({ href: '/new' }).run();
    const saved = getMarkdown(editor);
    expect(saved).toBe('See [run `npm i` now](/new) for setup.');
    expect(tenSaves(editor, saved).at(-1)).toBe(saved);
  });

  it('marks a linked code span from the Markdown it is pasted or typed as', () => {
    const editor = editors.ar;
    load(editor, 'راجع [`الأمر`](/guides/setup)');
    const node = textNodes(editor).find((each) => each.text === 'الأمر');
    expect(node && isCode(node) && hrefOf(node)).toBe('/guides/setup');
  });

  it('lets only links sit on inline code: every other mark is still kept out', () => {
    const { marks } = getSchema(buildEditorExtensions());
    const code = marks.code;
    if (!code) throw new Error('the editor has no code mark');
    const allowed = Object.values(marks)
      .filter((mark) => !code.excludes(mark))
      .map((mark) => mark.name);
    expect(allowed).toEqual(['link']);
  });
});

describe('inline code and links apart from each other save as before (#660)', () => {
  const unchanged = [
    'Run `npm i` first.',
    'Run `` a`b `` first.',
    'See [the setup guide](/guides/setup) first.',
    'See [**bold** and *italic*](/guides/setup) first.',
    '- Run `npm i`, then read [the guide](/guides/setup).',
    '> Run `npm i`, then read [the guide](/guides/setup).',
    '| Step | Command |\n| --- | --- |\n| Setup | `npm i` and [the guide](/guides/setup) |\n',
    'شغّل `npm i` ثم اقرأ [الدليل](/guides/setup).',
    '[one](/a)`code`[two](/a)',
  ];
  for (const source of unchanged) {
    it(`keeps ${JSON.stringify(source)} byte for byte over ten loads`, () => {
      expect(tenSaves(editors.en, source)).toEqual(Array.from({ length: 10 }, () => source));
    });
  }

  it('still drops bold, italic and strike from code, as before', () => {
    expect(tenSaves(editors.en, '**a `b` c** and *d `e` f* and ~~g `h` i~~').at(-1)).toBe('**a** `b` **c** and *d* `e` *f* and ~~g~~ `h` ~~i~~');
  });
});
