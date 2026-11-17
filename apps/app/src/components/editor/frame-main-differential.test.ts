// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOCUMENTATION_COMPONENTS } from '@nibleaf/shared/documentation-components';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { serializerCorpus } from './__fixtures__/serializer-corpus';
import { replaceOpeningAttribute, SUPPORTED_MDX_COMPONENTS } from './extensions/mdx-roundtrip';
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
 * now take one of three paths:
 * - `exact`: it saves byte for byte.
 * - `plain` (the `{/"/}` value): it saves exactly what main saves for the same page with
 *   that value a plain `"x"`. The component is read now; what is left is how the editor
 *   already lays that component out (a self-closing callout, a group's children, an
 *   inline body).
 * - `body-normalized`: its opener still can't be read and holds another component, so
 *   the opener is kept byte for byte up to its blank line (or its own lone `>` line) and
 *   its closing tag on its own (it can't take a body holding a component). It saves the
 *   opener and closing tag byte for byte, exactly what main saves for the body between
 *   them as a page of its own (that body is top-level content now), and to a fixed
 *   point. Main's save of a childless `<File name="Inner">` body drops its "Inner
 *   text.": that is main's own normalization of that body, standalone, not a new loss.
 * Each path checks the save after an attribute edit too: a `plain` page's is main's for
 * the plain-value page, and an `exact` or `body-normalized` page's rewrites only what is
 * left editable (see the edit oracle below).
 * Every count is asserted exactly, so anything that widens the exception fails here.
 * Every other page still gives main's digest. From the first count of 338 `exact` and
 * 45 `plain`: keeping a broken opener only to its own block (the #714 review) moved 30
 * pages out of `exact`; keeping the whole authored pair when its own closing tag is the
 * next component tag brought 20 back, and keeping a lone `>` line with its opener 2 more,
 * so 330 `exact`, 45 `plain` and 8 `body-normalized`. Then page 1234 moved from `plain`
 * to `exact`: its `{/"/\}` holds a `\` JavaScript can't read there, so main's reading
 * decides that expression, and the whole broken component is kept byte for byte: 331
 * `exact`, 44 `plain`. Once later work (#714 phase 0b,
 * or after) saves those layouts byte for byte, `plain` and `body-normalized` shrink to
 * zero, and the exception should shrink with them.
 *
 * `__fixtures__/non-frame-714-main.json` holds main's results for those pages, each
 * checked against its digest in `non-frame-main.json`, the plain-value saves and main's
 * saves of their bodies as pages of their own. It was made by running this file against
 * main's `mdx-roundtrip.ts` with `WRITE_NON_FRAME_714_MAIN=1`.
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
 *  same page with the value a plain "x"; for a component with a body of blocks, main's
 *  save of that body as a page of its own. */
interface Main714Record extends Omit<MainResult, 'nodes'> {
  index: number;
  nodes: string;
  valueText: string;
  plainSaved: string | null;
  /** Main's save of that plain-value page after its attribute edit. */
  plainEdited: string | null;
  /** Where the plain value `"x"` sits in `plainEdited` when the edit left it there (it
   *  set another node's attribute), or -1 when the edit replaced it. */
  plainEditedValueAt: number;
  bodySaved: string | null;
}

/** A component's body between its opener and its closing tag: the blank lines around it,
 *  and what is between them. */
const bodyOf = (page: string, seeded: SeededPage): { before: string; body: string; after: string } | null => {
  if (seeded.closerAt === null) return null;
  const between = page.slice(seeded.openerEnd, seeded.closerAt);
  const body = between.trim();
  const start = between.indexOf(body);
  return { before: between.slice(0, start), body, after: between.slice(start + body.length) };
};

/** The node the edit sets `key` on: its type, and the opening tag it was read from. */
type EditTarget = { type: string; sourceOpen: string };

/**
 * The edit oracle for a `plain` page: exactly one expected save after the edit, chosen
 * by the node the edit targets. When it targets the component holding the expression
 * (its opener holds `key={…}`), the edit replaced that value, so the save is main's
 * edit of the plain-value page as it is. Otherwise the value is untouched: main's edit
 * with only the plain value's span, at its recorded offset, put back to the expression.
 * Every other byte must match.
 */
function plainEditExpected(record: Main714Record, key: string, target: EditTarget | null): string | null {
  if (record.plainEdited === null) return null;
  if (target?.sourceOpen.includes(`${key}=${record.valueText}`)) return record.plainEdited;
  const at = record.plainEditedValueAt;
  if (at < 0 || !record.plainEdited.startsWith('"x"', at)) return null;
  return `${record.plainEdited.slice(0, at)}${record.valueText}${record.plainEdited.slice(at + 3)}`;
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
  /** Where the component's opener ends, and where its own closing tag starts when it has
   *  a body of its own blocks (null for an inline or self-closing one). */
  openerEnd: number;
  closerAt: number | null;
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
      let closerAt: number | null = null;
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
        if (!selfClosing) closerAt = componentAt + opener.length + body.length;
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
        openerEnd: componentAt + opener.length,
        closerAt,
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
  const digest = (page: string, key: string): MainResult & { digest: string; blankLineValue: boolean; target: EditTarget | null } => {
    editor.commands.setContent(page, { emitUpdate: false });
    const nodes: string[] = [];
    let blankLineValue = false;
    let target: { pos: number; type: string; attrs: Record<string, unknown> } | undefined;
    editor.state.doc.descendants((node, pos) => {
      nodes.push(node.type.name);
      blankLineValue ||= Object.values(node.attrs).some((value) => typeof value === 'string' && BLANK_LINE.test(value));
      if (!target && key in node.attrs) target = { pos, type: node.type.name, attrs: node.attrs };
    });
    const saved = getMarkdown(editor);
    let edited: string | null = null;
    if (target) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, [key]: 'Edited' }));
      edited = getMarkdown(editor);
    }
    const edit: EditTarget | null = target ? { type: target.type, sourceOpen: String(target.attrs.sourceOpen ?? '') } : null;
    return { digest: digestOf({ nodes, saved, edited }), nodes, saved, edited, blankLineValue, target: edit };
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
        const plain = seeded.value === REGEX_VALUE ? digest(plainPage, seeded.key) : null;
        // The plain value's offset in main's edited save, when the edit left it: the value
        // is the opener's first attribute, so its `="x"` is the page's first (an inserted
        // character may be in its name: `co>lor=`, `ti}p=`).
        const valueAt = (edited: string) => {
          const at = edited.indexOf('="x"');
          return at < 0 ? -1 : at + 1;
        };
        const body = bodyOf(page, seeded);
        const bodySaved = body ? digest(body.body, seeded.key).saved : null;
        records.push({
          index,
          nodes: result.nodes.join(','),
          saved: result.saved,
          edited: result.edited,
          valueText: seeded.valueText,
          plainSaved: plain?.saved ?? null,
          plainEdited: plain?.edited ?? null,
          plainEditedValueAt: plain?.edited ? valueAt(plain.edited) : -1,
          bodySaved,
        });
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
    // (the regular expression value) save what main saves for the same page with the value
    // a plain "x"; `bodyNormalized` pages keep their unreadable opener and its closing tag
    // byte for byte, hold between them exactly what main saves for that body as a page of
    // its own (the opener is opaque, so the body is top-level content), and save to a
    // fixed point.
    const exact: string[] = [];
    const plain: string[] = [];
    const bodyNormalized: string[] = [];
    const plainValue = (record: Main714Record) => record.plainSaved?.replace('"x"', record.valueText);
    // The edit oracle. A `plain` page's edit: see plainEditExpected. On `exact` and
    // `body-normalized` pages, whose opener may be opaque, the edit sets `key` on what is
    // left editable, and on nothing else: the node it targets is an
    // opaque one (its source is kept, so the save is unchanged), or a component, whose
    // authored opening tag alone is rewritten, as the editor rewrites any opening tag; with
    // nothing to target, there is no edit.
    const editOk = (result: { saved: string; edited: string | null; target: EditTarget | null }, key: string): boolean => {
      const { saved, edited, target } = result;
      if (!target) return edited === null;
      if (target.type.startsWith('mdxOpaque')) return edited === saved;
      // What the edit rewrites, and to what: the node's authored opening tag; or, for a node
      // with none, the image it is (its title) or the opening tag the editor wrote for it.
      let from: string;
      let to: string;
      if (target.sourceOpen) {
        const name = /^<([A-Za-z][\w.:-]*)/.exec(target.sourceOpen)?.[1] ?? '';
        from = target.sourceOpen;
        to = replaceOpeningAttribute(target.sourceOpen, name, key, 'Edited');
      } else if (target.type === 'image') {
        from = /!\[[^\]]*\]\([^)\s]*\)/.exec(saved)?.[0] ?? '';
        to = `${from.slice(0, -1)} "Edited")`;
      } else {
        const name = target.type.replace(/^mdx/, '');
        from = `<${name}>`;
        to = `<${name} ${key}="Edited">`;
      }
      const at = from ? saved.indexOf(from) : -1;
      return at >= 0 && edited === `${saved.slice(0, at)}${to}${saved.slice(at + from.length)}`;
    };
    const withMainBody = (page: string, seeded: SeededPage, record: Main714Record): string | null => {
      const body = bodyOf(page, seeded);
      if (!body || record.bodySaved === null || seeded.closerAt === null) return null;
      return `${page.slice(0, seeded.openerEnd)}${body.before}${record.bodySaved}${body.after}${page.slice(seeded.closerAt)}`;
    };
    // Pages saved and edited byte for byte as main does, whose nodes alone differ: text
    // with a `{…}` (`{/"/}`) that main's scan misread as a runaway string now loads as an
    // opaque inline expression node, kept byte for byte. Exactly these, by index.
    const nodesOnly: number[] = [];
    const changed = results.flatMap((result, index) => {
      if (result.digest === main.digests[index]) return [];
      const page = pages[index]?.page ?? '';
      const record = lossyOnMain.get(index);
      if (record && result.saved === record.saved && result.edited === record.edited) nodesOnly.push(index);
      const seeded = pages[index]?.seeded;
      if (record && seeded && result.saved === page && editOk(result, seeded.key)) {
        exact.push(page);
        return [];
      }
      if (
        record &&
        seeded?.value === REGEX_VALUE &&
        result.saved === plainValue(record) &&
        result.edited === plainEditExpected(record, seeded.key, result.target)
      ) {
        plain.push(page);
        return [];
      }
      if (
        record &&
        seeded &&
        seeded.value !== REGEX_VALUE &&
        seeded.closerAt !== null &&
        result.saved.startsWith(page.slice(0, seeded.openerEnd)) &&
        result.saved.endsWith(page.slice(seeded.closerAt)) &&
        result.saved === withMainBody(page, seeded, record) &&
        digest(result.saved, seeded.key).saved === result.saved &&
        editOk(result, seeded.key)
      ) {
        bodyNormalized.push(page);
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
      `[frame-main-differential] ${pages.length} pages, ${differences.length} differences, ${kept.length} kept by #721, #714 ${exact.length} exact, ${plain.length} as a plain value and ${bodyNormalized.length} body-normalized`,
    );
    expect(differences.slice(0, 3)).toEqual([]);
    expect(lost.map((result) => result.page)).toEqual([]);
    expect(kept.length).toBe(4);
    expect(exact.length).toBe(331);
    expect(plain.length).toBe(44);
    expect(bodyNormalized.length).toBe(8);
    expect(nodesOnly).toEqual([132, 943, 972, 1132]);
  }, 600_000);
});

describe('the #714 plain edit oracle', () => {
  // Damage a reviewer injected into two `plain` pages' edits: on page 149 the edit targets
  // the Card after the Note, and the untouched `title={/"/}` became `title="x"`; on page
  // 425 the edit targets the expression's own Expandable, and `id="x"` became `id={/"/}`.
  // The oracle accepts each page's real edit and rejects the damaged one.
  const injected = [
    {
      index: 149,
      page: 'Intro.\n\n<Note title={/"/} data-x={1} />\n\n<Card title="Next">\n\nMore\n\n</Card>\n\nOutro.',
      target: { type: 'mdxCard', sourceOpen: '<Card title="Next">' },
      edited: 'Intro.\n\n<Note title={/"/} data-x={1} />\n\n</Callout>\n\n<Card title="Edited">\n\nMore\n\n</Card>\n\nOutro.',
      damaged: 'Intro.\n\n<Note title="x" data-x={1} />\n\n</Callout>\n\n<Card title="Edited">\n\nMore\n\n</Card>\n\nOutro.',
    },
    {
      index: 425,
      page: 'Intro.\n\nSome <Expandable title={/"/}id="x"\n>inline text</Expandable> more text.\n\nOutro.',
      target: { type: 'mdxExpandable', sourceOpen: '<Expandable title={/"/}id="x"\n>' },
      edited: 'Intro.\n\nSome\n\n<Expandable title="Edited"id="x"\n>\n\ninline text\n\n</Expandable>\n\n more text.\n\nOutro.',
      damaged: 'Intro.\n\nSome\n\n<Expandable title="Edited"id={/"/}\n>\n\ninline text\n\n</Expandable>\n\n more text.\n\nOutro.',
    },
  ];

  it.each(injected)('accepts page $index’s real edit and rejects its damaged one', ({ index, page, target, edited, damaged }) => {
    expect(pages[index]?.page).toBe(page);
    const records = (JSON.parse(readFileSync(FIXTURE_714, 'utf8')) as { records: Main714Record[] }).records;
    const record = records.find((entry) => entry.index === index);
    const key = pages[index]?.key ?? '';
    expect(record).toBeDefined();
    if (!record) return;
    expect(plainEditExpected(record, key, target)).toBe(edited);
    expect(plainEditExpected(record, key, target)).not.toBe(damaged);
  });
});
