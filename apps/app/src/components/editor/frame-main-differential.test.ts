// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { serializerCorpus } from './__fixtures__/serializer-corpus';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #579 changes how a Frame's opener is read and nothing else. For every page here
 * without a Frame, the editor gives what main gives: the same nodes, the same
 * saved page, and the same saved page after an attribute edit. The pages: a seeded
 * set of component openers (every other supported component, the `<IMG>` alias, an
 * unknown component; backslashes before quotes, JSX and regular expressions inside
 * `{…}`, tag text inside values, unterminated values, adjacent attributes), and the
 * serializer corpus's pages (#693).
 *
 * `__fixtures__/non-frame-main.json` holds a digest of main's result for each page;
 * it was made by running this file against main's editor with
 * `WRITE_NON_FRAME_MAIN=1`. Regenerate it only when non-Frame reading changes on
 * purpose.
 */

const SEED = 0x57_9a_11_0e;
const COUNT = 1500;
const FIXTURE = resolve(import.meta.dirname, '__fixtures__/non-frame-main.json');

const COMPONENTS = [
  ['Card', 'title'],
  ['Step', 'title'],
  ['Accordion', 'title'],
  ['Tab', 'title'],
  ['Update', 'label'],
  ['Callout', 'type'],
  ['Note', 'title'],
  ['Tooltip', 'tip'],
  ['Badge', 'title'],
  ['IMG', 'alt'],
  ['Widget', 'title'],
] as const;

function seededPages(): Array<{ page: string; key: string }> {
  let state = SEED;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const pick = <T>(values: readonly T[]): T => values[next() % values.length] as T;
  const VALUES = [
    '"A"',
    "'A'",
    '"Old\\"',
    "'Old\\'",
    '"a \\"b\\" c"',
    '{"x"}',
    '{"a } \\" b"}',
    '{a / b}',
    '{/"/}',
    '{() => { return 1; }}',
    '{<b title="</Card>">x</b>}',
    '"<b>"',
    '"a > b"',
    '"ü"',
    '"x',
    '{"x"',
  ] as const;
  const FOLLOWERS = [
    '',
    ' id="x"',
    'id="x"',
    ' data-x={1}',
    '{...props}',
    ' {...props}',
    ' hidden',
    ' xml:lang="en"',
    ' a.b="x"',
    ' href="/docs"title="B"',
    '\n  aria-label="L"\n',
  ] as const;
  const BODIES = [
    '\n\nBody text.\n\n',
    '\n\n![Diagram](/diagram.png)\n\n',
    '\n  <iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>\n',
    '\n\n<b title="</Card>">x</b>\n\n',
  ] as const;
  const pages: Array<{ page: string; key: string }> = [];
  for (let index = 0; index < COUNT; index++) {
    const [tag, key] = pick(COMPONENTS);
    let opener = `<${tag} ${key}=${pick(VALUES)}${pick(FOLLOWERS)}${pick(['>', ' />', '\n>'] as const)}`;
    if (next() % 4 === 0) {
      const at = tag.length + 1 + (next() % (opener.length - tag.length - 1));
      opener = `${opener.slice(0, at)}${pick(['\\', '"', "'", '{', '}', '>', '`'] as const)}${opener.slice(at)}`;
    }
    const component = opener.endsWith('/>') ? opener : `${opener}${pick(BODIES)}</${tag}>`;
    const after = pick(['', '\n\n## Later heading', '\n\n<Card title="Next">\n\nMore\n\n</Card>'] as const);
    pages.push({ page: `Intro.\n\n${component}${after}\n\nOutro.`, key });
  }
  return pages;
}

const pages = [
  ...seededPages(),
  ...serializerCorpus()
    .map((entry) => ({ page: entry.source, key: 'title' }))
    .filter(({ page }) => !/<\/?frame\b/i.test(page)),
];

describe('pages without a Frame read as on main', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());

  /** The page's nodes, its save, and its save after the first node with `key` has it set to `Edited`. */
  const digest = (page: string, key: string): string => {
    editor.commands.setContent(page, { emitUpdate: false });
    const nodes: string[] = [];
    let target: { pos: number; attrs: Record<string, unknown> } | undefined;
    editor.state.doc.descendants((node, pos) => {
      nodes.push(node.type.name);
      if (!target && key in node.attrs) target = { pos, attrs: node.attrs };
    });
    const saved = getMarkdown(editor);
    let edited: string | null = null;
    if (target) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, [key]: 'Edited' }));
      edited = getMarkdown(editor);
    }
    return createHash('sha256').update(JSON.stringify({ nodes, saved, edited })).digest('hex').slice(0, 16);
  };

  it(`gives main’s nodes, save and edited save for all ${pages.length} pages`, () => {
    const digests = pages.map(({ page, key }) => digest(page, key));
    if (process.env.WRITE_NON_FRAME_MAIN) writeFileSync(FIXTURE, `${JSON.stringify({ pages: pages.length, digests }, null, 2)}\n`);
    const main = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { pages: number; digests: string[] };
    expect(main.pages).toBe(pages.length);
    const differences = digests.flatMap((value, index) => (value === main.digests[index] ? [] : [pages[index]?.page]));
    console.info(`[frame-main-differential] ${pages.length} pages, ${differences.length} differences`);
    expect(differences.slice(0, 3)).toEqual([]);
  }, 600_000);
});
