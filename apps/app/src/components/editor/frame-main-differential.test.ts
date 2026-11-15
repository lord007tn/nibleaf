// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOCUMENTATION_COMPONENTS } from '@nibleaf/shared/documentation-components';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { serializerCorpus } from './__fixtures__/serializer-corpus';
import { SUPPORTED_MDX_COMPONENTS } from './extensions/mdx-roundtrip';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #579 changes how a Frame's opener is read and nothing else. For every page here
 * without a Frame, the editor gives what main gives: the same nodes, the same
 * saved page, and the same saved page after an attribute edit. The pages: a seeded
 * set of component openers, `PER_COMPONENT` for every component in the editor's
 * registry but Frame (`SUPPORTED_MDX_COMPONENTS`, so a new component is covered as
 * soon as it's added), the `<IMG>` alias and an unknown component, with
 * backslashes before quotes, JSX and regular expressions inside `{…}`, tag text
 * inside values, unterminated values, adjacent attributes, self-closing, inline and
 * nested forms; and the serializer corpus's pages (#693).
 *
 * `__fixtures__/non-frame-main.json` holds a digest of main's result for each page;
 * it was made by running this file against main's editor with
 * `WRITE_NON_FRAME_MAIN=1`. Regenerate it only when non-Frame reading changes on
 * purpose.
 */

const SEED = 0x57_9a_11_0e;
const PER_COMPONENT = 40;
/** Each component occurs on at least this many generated pages. */
const MIN_PAGES = 20;
const FIXTURE = resolve(import.meta.dirname, '__fixtures__/non-frame-main.json');

/** Every supported component but Frame, with the attribute an edit sets; then the
 *  `<IMG>` alias and a component the editor doesn't know. */
const COMPONENTS: ReadonlyArray<readonly [tag: string, key: string, inline: boolean]> = [
  ...Object.values(SUPPORTED_MDX_COMPONENTS)
    .filter((definition) => definition.canonical !== 'Frame')
    .map((definition) => [definition.canonical, definition.attrs[0] ?? 'title', Boolean(definition.inline)] as const),
  ['IMG', 'alt', true],
  ['Widget', 'title', false],
];

function seededPages(): Array<{ page: string; key: string; tag: string }> {
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
  const pages: Array<{ page: string; key: string; tag: string }> = [];
  for (let round = 0; round < PER_COMPONENT; round++) {
    for (const [tag, key, inline] of COMPONENTS) {
      let opener = `<${tag} ${key}=${pick(VALUES)}${pick(FOLLOWERS)}${pick(['>', ' />', '\n>'] as const)}`;
      if (next() % 4 === 0) {
        const at = tag.length + 1 + (next() % (opener.length - tag.length - 1));
        opener = `${opener.slice(0, at)}${pick(['\\', '"', "'", '{', '}', '>', '`'] as const)}${opener.slice(at)}`;
      }
      const selfClosing = opener.endsWith('/>');
      let component: string;
      if (inline || next() % 5 === 0) {
        // In a line of text, as inline components are written.
        component = `Some ${selfClosing ? opener : `${opener}inline text</${tag}>`} more text.`;
      } else {
        const body = pick([
          '\n\nBody text.\n\n',
          '\n\n![Diagram](/diagram.png)\n\n',
          '\n  <iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>\n',
          '\n\n<b title="</Card>">x</b>\n\n',
          // Nested: another component, or the same one, inside.
          '\n\n<Card title="Inner">\n\nInner text.\n\n</Card>\n\n',
          `\n\n<${tag} ${key}="Inner">\n\nInner text.\n\n</${tag}>\n\n`,
        ] as const);
        component = selfClosing ? opener : `${opener}${body}</${tag}>`;
      }
      const after = pick(['', '\n\n## Later heading', '\n\n<Card title="Next">\n\nMore\n\n</Card>'] as const);
      pages.push({ page: `Intro.\n\n${component}${after}\n\nOutro.`, key, tag });
    }
  }
  return pages;
}

const seeded = seededPages();
const pages = [
  ...seeded,
  ...serializerCorpus()
    .map((entry) => ({ page: entry.source, key: 'title' }))
    .filter(({ page }) => !/<\/?frame\b/i.test(page)),
];

describe('the generated pages cover every component but Frame', () => {
  it(`has every registry component but Frame, the <IMG> alias and an unknown one on at least ${MIN_PAGES} pages`, () => {
    const registry = DOCUMENTATION_COMPONENTS.flatMap((component) => (component.tag && component.tag !== 'Frame' ? [component.tag] : []));
    const generated = COMPONENTS.map(([tag]) => tag);
    expect([...generated].sort()).toEqual([...registry, 'IMG', 'Widget'].sort());
    // Pages where each tag occurs as an opener, wherever it is (its own pages, nested, after).
    const counts = Object.fromEntries(
      generated.map((tag) => [tag, seeded.filter(({ page }) => new RegExp(`<${tag}(?![\\w.:-])`).test(page)).length]),
    );
    const low = Object.entries(counts).filter(([, count]) => count < MIN_PAGES);
    const values = Object.values(counts);
    console.info(
      `[frame-main-differential] ${generated.length} tags on ${seeded.length} seeded pages, min ${Math.min(...values)} max ${Math.max(...values)}: ${JSON.stringify(counts)}`,
    );
    expect(low).toEqual([]);
  });
});

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
