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
 * The one change since is #721: a component whose attribute value, as the editor
 * reads it, holds a blank line is kept, where main dropped it and the whole rest of
 * the page with it. Here that is a quoted value read with backslash escapes past
 * `\"` and across the blank line after it (`title="Old\"⏎>⏎⏎<b title="`). Such an
 * opener ends where those escapes end it, so the text between that end and the
 * MDX grammar's is still rewritten: reading non-Frame values with the grammar is
 * #714. Each such page keeps its opener and everything from its closing tag on,
 * saves to a fixed point, and is counted.
 *
 * And #714: a `{…}` value is read as JavaScript (a quote inside `/"/` ends nothing),
 * and a component opener that still can't be read is kept byte for byte with its
 * closing tag. Main saved those pages with a loss, so their digests change. The
 * exception covers only a page with one of the values #714 reads differently
 * (`{/"/}`, `"x`, `{"x"`) or a character inserted into its opener (which can leave a
 * quote or brace unterminated), that main's own result saves with a loss; and that page must
 * now either save byte for byte (`exact`), or save exactly what main saves for the
 * same page with that value a plain `"x"` (`plain`): the component is read now, and
 * what is left is how the editor already lays that component out (a self-closing
 * callout, a group's children, an inline body). Both counts are asserted exactly, so
 * anything that widens the exception fails here. Every other page still gives main's
 * digest. Once later work (#714 phase 0b, or after) saves those layouts byte for byte,
 * `plain` shrinks to zero, and the exception should shrink with it.
 *
 * `__fixtures__/non-frame-714-main.json` holds main's results for those pages, each
 * checked against its digest in `non-frame-main.json`, and the plain-value saves. It
 * was made by running this file against main's `mdx-roundtrip.ts` with
 * `WRITE_NON_FRAME_714_MAIN=1`.
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
/** A blank line inside a value: a line of spaces and tabs at most. */
const BLANK_LINE = /\n[ \t]*\n/;
const FIXTURE = resolve(import.meta.dirname, '__fixtures__/non-frame-main.json');
const FIXTURE_714 = resolve(import.meta.dirname, '__fixtures__/non-frame-714-main.json');

interface MainResult {
  nodes: string[];
  saved: string;
  edited: string | null;
}

/** Main's result for a page #714 may read differently that main saves with a loss (its
 *  nodes joined with commas); for the regular expression value, also main's save of the
 *  same page with the value a plain "x". */
interface Main714Record extends Omit<MainResult, 'nodes'> {
  index: number;
  nodes: string;
  valueText: string;
  plainSaved: string | null;
}

const digestOf = ({ nodes, saved, edited }: MainResult): string =>
  createHash('sha256').update(JSON.stringify({ nodes, saved, edited })).digest('hex').slice(0, 16);

/** Every supported component but Frame, with the attribute an edit sets; then the
 *  `<IMG>` alias and a component the editor doesn't know. */
const COMPONENTS: ReadonlyArray<readonly [tag: string, key: string, inline: boolean]> = [
  ...Object.values(SUPPORTED_MDX_COMPONENTS)
    .filter((definition) => definition.canonical !== 'Frame')
    .map((definition) => [definition.canonical, definition.attrs[0] ?? 'title', Boolean(definition.inline)] as const),
  ['IMG', 'alt', true],
  ['Widget', 'title', false],
];

/** The generated attribute values #714 reads differently: a regular expression with a
 *  quote in it, an unterminated quote and an unterminated brace. */
const VALUES_714: ReadonlySet<string> = new Set(['{/"/}', '"x', '{"x"']);
/** The one of them whose pages have a plain-value counterpart (see the #714 exception). */
const REGEX_VALUE = '{/"/}';

interface SeededPage {
  page: string;
  key: string;
  tag: string;
  /** The value as generated, and as written on the page (an inserted character may be in
   *  it) with where it starts. */
  value: string;
  valueText: string;
  valueAt: number;
  /** Whether a character was inserted into the opener (which can leave a quote or brace
   *  unterminated). */
  inserted: boolean;
}

function seededPages(): SeededPage[] {
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
  const pages: SeededPage[] = [];
  for (let round = 0; round < PER_COMPONENT; round++) {
    for (const [tag, key, inline] of COMPONENTS) {
      const value = pick(VALUES);
      let opener = `<${tag} ${key}=${value}${pick(FOLLOWERS)}${pick(['>', ' />', '\n>'] as const)}`;
      let valueStart = tag.length + key.length + 3;
      let valueEnd = valueStart + value.length;
      const inserted = next() % 4 === 0;
      if (inserted) {
        const at = tag.length + 1 + (next() % (opener.length - tag.length - 1));
        opener = `${opener.slice(0, at)}${pick(['\\', '"', "'", '{', '}', '>', '`'] as const)}${opener.slice(at)}`;
        if (at <= valueStart) valueStart++;
        if (at < valueEnd) valueEnd++;
      }
      const selfClosing = opener.endsWith('/>');
      let component: string;
      let componentAt = 'Intro.\n\n'.length;
      if (inline || next() % 5 === 0) {
        componentAt += 'Some '.length;
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
      pages.push({
        page: `Intro.\n\n${component}${after}\n\nOutro.`,
        key,
        tag,
        value,
        valueText: opener.slice(valueStart, valueEnd),
        valueAt: componentAt + valueStart,
        inserted,
      });
    }
  }
  return pages;
}

const seeded = seededPages();
const pages: Array<{ page: string; key: string; seeded?: SeededPage }> = [
  ...seeded.map((seededPage) => ({ page: seededPage.page, key: seededPage.key, seeded: seededPage })),
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

  /** The page's nodes, its save, and its save after the first node with `key` has it
   *  set to `Edited`; and whether a node holds an attribute value with a blank line. */
  const digest = (page: string, key: string): MainResult & { digest: string; blankLineValue: boolean } => {
    editor.commands.setContent(page, { emitUpdate: false });
    const nodes: string[] = [];
    let blankLineValue = false;
    let target: { pos: number; attrs: Record<string, unknown> } | undefined;
    editor.state.doc.descendants((node, pos) => {
      nodes.push(node.type.name);
      blankLineValue ||= Object.values(node.attrs).some((value) => typeof value === 'string' && BLANK_LINE.test(value));
      if (!target && key in node.attrs) target = { pos, attrs: node.attrs };
    });
    const saved = getMarkdown(editor);
    let edited: string | null = null;
    if (target) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, [key]: 'Edited' }));
      edited = getMarkdown(editor);
    }
    return { digest: digestOf({ nodes, saved, edited }), nodes, saved, edited, blankLineValue };
  };

  it(`gives main’s nodes, save and edited save for all ${pages.length} pages, but #721’s and #714’s`, () => {
    const results = pages.map(({ page, key }) => digest(page, key));
    const digests = results.map((result) => result.digest);
    if (process.env.WRITE_NON_FRAME_MAIN) writeFileSync(FIXTURE, `${JSON.stringify({ pages: pages.length, digests }, null, 2)}\n`);
    const main = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { pages: number; digests: string[] };
    expect(main.pages).toBe(pages.length);
    if (process.env.WRITE_NON_FRAME_714_MAIN) {
      // Run against main's editor: its results for the pages with a #714 value or an
      // inserted character that it saves with a loss, where they are what the digests
      // above hold.
      const records: Main714Record[] = [];
      for (const [index, { page, seeded }] of pages.entries()) {
        const result = results[index];
        if (!seeded || !(VALUES_714.has(seeded.value) || seeded.inserted) || !result) continue;
        if (result.saved === page || result.digest !== main.digests[index]) continue;
        const plainPage = `${page.slice(0, seeded.valueAt)}"x"${page.slice(seeded.valueAt + seeded.valueText.length)}`;
        const plainSaved = seeded.value === REGEX_VALUE ? digest(plainPage, seeded.key).saved : null;
        records.push({ index, nodes: result.nodes.join(','), saved: result.saved, edited: result.edited, valueText: seeded.valueText, plainSaved });
      }
      writeFileSync(FIXTURE_714, `${JSON.stringify({ pages: pages.length, records }, null, 2)}\n`);
    }
    const main714 = JSON.parse(readFileSync(FIXTURE_714, 'utf8')) as { pages: number; records: Main714Record[] };
    expect(main714.pages).toBe(pages.length);
    // Each record is main's own result for its page: it hashes to main's digest.
    const unmatched = main714.records.filter((record) => digestOf({ ...record, nodes: record.nodes.split(',') }) !== main.digests[record.index]);
    expect(unmatched.map((record) => record.index)).toEqual([]);
    const lossyOnMain = new Map(
      main714.records.filter((record) => record.saved !== pages[record.index]?.page).map((record) => [record.index, record]),
    );
    // #714: see the comment at the top. `exact` pages now save byte for byte; `plain` pages
    // save what main saves for the same page with the value a plain "x".
    const exact: string[] = [];
    const plain: string[] = [];
    const changed = results.flatMap((result, index) => {
      if (result.digest === main.digests[index]) return [];
      const page = pages[index]?.page ?? '';
      const record = lossyOnMain.get(index);
      if (record && result.saved === page) {
        exact.push(page);
        return [];
      }
      if (record?.plainSaved != null && result.saved === record.plainSaved.replace('"x"', record.valueText)) {
        plain.push(page);
        return [];
      }
      return [{ ...result, page }];
    });
    // #721: the component and the rest of the page are kept, and the save is a fixed point.
    const kept = changed.filter((result) => result.blankLineValue);
    const lost = kept.filter(({ page, saved }) => {
      const opener = page.slice(0, page.indexOf('"', page.indexOf('="') + 2) + 1);
      const fromClose = page.slice(page.indexOf('\n\n</') + 2);
      return !saved.startsWith(opener) || !saved.endsWith(fromClose) || digest(saved, 'title').saved !== saved;
    });
    const differences = changed.filter((result) => !result.blankLineValue).map((result) => result.page);
    console.info(
      `[frame-main-differential] ${pages.length} pages, ${differences.length} differences, ${kept.length} kept by #721, #714 ${exact.length} exact and ${plain.length} as a plain value`,
    );
    expect(differences.slice(0, 3)).toEqual([]);
    expect(lost.map((result) => result.page)).toEqual([]);
    expect(kept.length).toBe(4);
    expect(exact.length).toBe(338);
    expect(plain.length).toBe(44);
  }, 600_000);
});
