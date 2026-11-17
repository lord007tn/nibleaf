// @vitest-environment jsdom
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #714 reads `{…}` as JavaScript. This guards what main already got right: every page
 * here that main saves byte for byte with its components editable is still saved byte
 * for byte, with at least those components editable. The pages: expressions mixing
 * division and regular expressions, JSX, template literals with `${}`, `//` and `/* *\/`
 * comments, strings with escapes and entities; each standalone in text, on its own
 * line, in a Card's attribute (with a body, self-closing, nested in another Card, in a
 * Frame), in code spans and in a fence; with LF and with CRLF line endings.
 *
 * `__fixtures__/expression-shapes-main.json` holds, for each page, whether main
 * (fc7f92e2) saves it byte for byte, and the components it loads editable. It was made
 * by running this file against main's `mdx-roundtrip.ts` with
 * `WRITE_EXPRESSION_SHAPES_MAIN=1`.
 */

const FIXTURE = resolve(import.meta.dirname, '__fixtures__/expression-shapes-main.json');

const EXPRESSIONS = [
  'a / 2',
  '(a + b) / 2',
  'function(){} / 2',
  '[function()\n{} / 2]',
  '[function(){} /2,\nfunction(){} /2]',
  '() => { return /"}/.test(s); }',
  "[1, /'/]",
  '() => { if (a) /x"/.test(b); }',
  'x ? /}/ : y',
  'obj.return / 2',
  'a++ / 2',
  '{a: 1}.a / 2',
  'function* () { yield /x/; }',
  '<b title="</Card>">x</b>',
  '<Icon size={2} />',
  '<>a/b</>',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal written into the page.
  '`a${"}"}b`',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal written into the page.
  '`${x}/${y}`',
  '1 /* } */',
  'a // }\n',
  '/* "\' */ 1',
  '"a } \\" b"',
  "'it\\'s'",
  '"A&amp;B"',
  // More `/`s after function bodies than a scan reads both ways.
  `[${new Array(17).fill('function(){} /2').join(',\n')}]`,
];

const CONTEXTS: ReadonlyArray<(expression: string) => string> = [
  (e) => `Before {${e}} after.`,
  // A later `/` on the line, where a regular expression read from an earlier `/` could end.
  (e) => `Before {${e}} plus {a / 2} after.`,
  (e) => `<Card title="Tour" data-x={${e}} data-y={a / 2}>\n\nBody\n\n</Card>`,
  (e) => `{${e}}\n\nAfter.`,
  (e) => `<Card title="Tour" data-x={${e}}>\n\nBody\n\n</Card>`,
  (e) => `<Card title="A&amp;B" data-x={${e}} />`,
  (e) => `<Card title="Outer">\n\n<Step title="T" data-x={${e}}>\n\nText\n\n</Step>\n\n</Card>`,
  (e) => `<Frame caption="Tour" data-x={${e}}>\n\n![Diagram](/diagram.png)\n\n</Frame>`,
  (e) => `Code \`{${e}}\` and \`<Card x={${e}}>\` here.`,
  (e) => `\`\`\`mdx\n<Card x={${e}}>\n\`\`\`\n\nAfter.`,
];

const pages = (['\n', '\r\n'] as const).flatMap((newline) =>
  CONTEXTS.flatMap((context) => EXPRESSIONS.map((expression) => context(expression).replace(/\n/g, newline))),
);

/** Components the editor structures (opaque nodes aside). */
const EDITABLE = (type: string) => type === 'callout' || (type.startsWith('mdx') && !type.startsWith('mdxOpaque'));

/** Whether `wanted` appears in `list` in order. */
const subsequence = (wanted: string[], list: string[]): boolean => {
  let at = 0;
  for (const item of list) if (item === wanted[at]) at++;
  return at === wanted.length;
};

describe('expression shapes main saves byte for byte', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());

  const read = (page: string): { exact: boolean; editable: string[] } => {
    editor.commands.setContent(page, { emitUpdate: false });
    const editable: string[] = [];
    editor.state.doc.descendants((node) => {
      if (EDITABLE(node.type.name)) editable.push(node.type.name);
    });
    return { exact: getMarkdown(editor) === page, editable };
  };

  it(`are still saved byte for byte, with their components editable, on all ${pages.length} pages`, () => {
    const results = pages.map(read);
    if (process.env.WRITE_EXPRESSION_SHAPES_MAIN) {
      const rows = results.map(({ exact, editable }) => [exact ? 1 : 0, editable.join(',')]);
      writeFileSync(FIXTURE, `${JSON.stringify({ pages: pages.length, results: rows }, null, 2)}\n`);
      return;
    }
    const main = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { pages: number; results: Array<[0 | 1, string]> };
    expect(main.pages).toBe(pages.length);
    const regressions = results.flatMap((result, index) => {
      const [exact, editable] = main.results[index] ?? [0, ''];
      if (!exact) return [];
      const wanted = editable ? editable.split(',') : [];
      return result.exact && subsequence(wanted, result.editable)
        ? []
        : [{ page: pages[index], exact: result.exact, editable: result.editable, main: wanted }];
    });
    expect(regressions).toEqual([]);
    // Most of these pages main saves byte for byte: the guard has something to guard.
    expect(main.results.filter(([exact]) => exact).length).toBeGreaterThan(pages.length / 2);
  }, 120_000);
});
