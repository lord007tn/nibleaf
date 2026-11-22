// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOCUMENTATION_COMPONENTS } from '@nibleaf/shared/documentation-components';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { COMPONENT_LAYOUT_CORPUS_PAGES, replayMainComponentLayout } from './__fixtures__/component-source-layout';
import { HARD_WRAPPED_AR, HARD_WRAPPED_EN, IMPORTED_INTRODUCTION, IMPORTED_QUICKSTART } from './__fixtures__/hard-wrapped-pages';
import jsxOpeners from './__fixtures__/jsx-openers-main.json';
import { attributeEditHolds, listItemLeadSources, quotedMarkSources } from './__fixtures__/list-item-leads';
import { serializerCorpus } from './__fixtures__/serializer-corpus';
import { SUPPORTED_MDX_COMPONENTS } from './extensions/mdx-roundtrip';
import { normalizeLineEndings, readLineEndings, restoreLineEndings } from './line-endings';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #721 changes how a component opener's attribute value holding a blank line reaches
 * the editor, and nothing else. For every page here without a blank line inside an
 * attribute value, the editor gives what main gives: the same nodes, the same saved
 * page, and the same saved page after an attribute edit. The pages: a seeded set of
 * openers for every component in the registry (`SUPPORTED_MDX_COMPONENTS`, so a new
 * component is covered as soon as it's added), with complete values that hold line breaks
 * but no blank line (CRLF, a lone CR, a line of other whitespace), blank lines next to an
 * opener but outside its values (between attributes, in its children, after it),
 * inline, self-closing, quoted, listed and nested forms, a Frame holding an embed and
 * a Callout's type; then the existing round-trip corpora: the serializer corpus
 * (#693), the generated opening tags of `jsx-openers-match-main.test.ts`, and the
 * hard-wrapped pages.
 *
 * `__fixtures__/blank-line-attribute-main.json` holds a digest of main's result for
 * each page. It was made by running this file against main's `mdx-roundtrip.ts`
 * (`git show origin/main:…`) with `WRITE_BLANK_LINE_MAIN=1`. Its `crAsLf` holds main's
 * result for each page with a CR, read with LF endings (#702, see below); it was made
 * the same way, against main's `markdown-output.ts` and `editor-change-origin.ts`.
 * Regenerate it only when attribute reading changes on purpose.
 */

const SEED = 0x72_1b_1a_9e;
const PER_COMPONENT = 24;
/** Each component occurs on at least this many generated pages. */
const MIN_PAGES = 20;
const FIXTURE = resolve(import.meta.dirname, '__fixtures__/blank-line-attribute-main.json');

const registry = DOCUMENTATION_COMPONENTS.flatMap((component) => (component.tag ? [component] : []));
/** Every supported component, with the attribute an edit sets. */
const COMPONENTS: ReadonlyArray<readonly [tag: string, key: string, inline: boolean, selfClosing: boolean]> = Object.values(
  SUPPORTED_MDX_COMPONENTS,
).map(
  (definition) =>
    [
      definition.canonical,
      definition.attrs.find((name) => !definition.booleans?.includes(name)) ?? 'title',
      Boolean(definition.inline),
      Boolean(registry.find((component) => component.tag === definition.canonical)?.selfClosing),
    ] as const,
);

/** A blank line inside a `"…"`, `'…'` or `{…}` value, read loosely (any value that
 *  might hold one), or a line break written as a reference: the pages #721 changes. */
const BLANK = String.raw`(?:\r\n|\r(?!\n)|\n)[ \t]*(?:\r\n|\r(?!\n)|\n)`;
const BLANK_LINE_VALUE = new RegExp(
  String.raw`=\s*(?:"[^"]*${BLANK}[^"]*"|'[^']*${BLANK}[^']*'|\{\{?[^{}]*${BLANK}[^{}]*\})|&#(?:10|13|x0?[ad]);`,
  'i',
);

function seededPages(): Array<{ page: string; key: string; tag: string }> {
  let state = SEED;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const pick = <T>(values: readonly T[]): T => values[next() % values.length] as T;
  // Line breaks, but never a blank line, inside a value.
  const VALUES = [
    '"A"',
    "'A'",
    '"a\nb"',
    "'a\n  b'",
    '"a\n  \nb"',
    '"a\n\u000b\nb"',
    '"a\r\nb"',
    '"a\rb"',
    '"a\\n\\nb"',
    '"R&amp;D\nx"',
    '{`a\nb`}',
    '{{\n  a: 1,\n  b: 2,\n}}',
    '{"a"}',
    '"<b>\n</Card>"',
  ] as const;
  // What follows the value: other attributes, a blank line between attributes.
  const FOLLOWERS = ['', ' id="x"', '\n\n  id="x"', '\n  aria-label="L"\n', ' hidden', ' data-x={1}\n\n', '{...props}'] as const;
  const BODIES = [
    '\n\nBody text.\n\n',
    '\n\nFirst.\n\n\n\n- one\n\n- two\n\n```js\nconst x = 1;\n\nconst y = 2;\n```\n\n',
    '\n  <iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>\n',
    '\n\n<Card title="Inner\nline">\n\nInner text.\n\n</Card>\n\n',
    'Text right after the opener.\n\nMore.\n\n',
  ] as const;
  const pages: Array<{ page: string; key: string; tag: string }> = [];
  for (let round = 0; round < PER_COMPONENT; round++) {
    for (const [tag, key, inline, selfClosing] of COMPONENTS) {
      const value = tag === 'Callout' && next() % 2 === 0 ? pick(['"warning"', "'tip'", '{"note"}', '"warn\ning"'] as const) : pick(VALUES);
      const close = selfClosing || next() % 6 === 0 ? ' />' : pick(['>', '\n>'] as const);
      const opener = `<${tag} ${key}=${value}${pick(FOLLOWERS)}${close}`;
      const closed = close.endsWith('/>');
      let component: string;
      if (inline || next() % 5 === 0) {
        component = `Some ${closed ? opener : `${opener}inline text</${tag}>`} more text.`;
      } else component = closed ? opener : `${opener}${pick(BODIES)}</${tag}>`;
      const place = next() % 4;
      if (place === 1) component = `- ${component.replace(/\n/g, '\n  ')}`;
      else if (place === 2) component = `> ${component.replace(/\n/g, '\n> ')}`;
      else if (place === 3) component = `<Steps>\n\n<Step title="S">\n\n${component}\n\n</Step>\n\n</Steps>`;
      const after = pick(['', '\n\n## Later heading', '\n\n<Card title="Next">\n\nMore\n\n</Card>'] as const);
      pages.push({ page: `Intro.\n\n${component}${after}\n\nOutro.`, key, tag });
    }
  }
  return pages;
}

const seeded = seededPages();
const corpora = [
  ...serializerCorpus().map((entry) => ({ page: entry.source, key: 'title' })),
  ...jsxOpeners.map((entry) => ({ page: entry.source, key: /^Intro\.\n\n<Frame /.test(entry.source) ? 'caption' : 'title' })),
  ...[HARD_WRAPPED_EN, HARD_WRAPPED_AR, IMPORTED_INTRODUCTION, IMPORTED_QUICKSTART].map((page) => ({ page, key: 'title' })),
];
const pages = [...seeded, ...corpora];
/** #604: the corpus pages with a list item led by a quote, heading or list, and those whose
 *  quoted marks main doubled (QUOTED_MARK_PAGES), checked against main in
 *  list-item-leads-main.test.ts. */
// Corpus pages 70 and 236 need a longer fence only after the corpus edit sequence.
const leadSources = listItemLeadSources(true);
const quotedSources = quotedMarkSources();
const isNamed = (page: string) => leadSources.has(page) || quotedSources.has(page);
/** The quoted mark pages whose saves here held a doubled mark on main: all but page 898, whose doubled mark only the serializer corpus edits write. */
const QUOTED_MARK_CHANGES = 7;

describe('the differential pages', () => {
  it(`cover every registry component on at least ${MIN_PAGES} pages, and none holds a blank line inside a value`, () => {
    expect(COMPONENTS.map(([tag]) => tag).sort()).toEqual(registry.map((component) => component.tag).sort());
    const counts = Object.fromEntries(
      COMPONENTS.map(([tag]) => [tag, seeded.filter(({ page }) => new RegExp(`<${tag}(?![\\w.:-])`).test(page)).length]),
    );
    const values = Object.values(counts);
    console.info(
      `[blank-line-differential] ${COMPONENTS.length} components on ${seeded.length} seeded pages, min ${Math.min(...values)} max ${Math.max(...values)}; ${corpora.length} corpus pages`,
    );
    expect(Object.entries(counts).filter(([, count]) => count < MIN_PAGES)).toEqual([]);
    expect(pages.filter(({ page }) => BLANK_LINE_VALUE.test(page)).map(({ page }) => page)).toEqual([]);
  });
});

describe('pages without a blank line inside an attribute value read as on main', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());
  /** Every node's attributes in `markdown`, loaded. */
  const attributesOf = (markdown: string): Array<Record<string, unknown>> => {
    editor.commands.setContent(markdown, { emitUpdate: false });
    const all: Array<Record<string, unknown>> = [];
    editor.state.doc.descendants((node) => {
      all.push(node.attrs);
    });
    return all;
  };

  /** The page's nodes with their attributes, its save, and its save after the first
   *  node with `key` has it set to `Edited`. */
  let componentLayouts = 0;
  const result = (page: string, key: string, replayLayout = false): { nodes: string[]; saved: string; edited: string | null } => {
    editor.commands.setContent(page, { emitUpdate: false });
    if (replayLayout && replayMainComponentLayout(editor)) componentLayouts++;
    const nodes: string[] = [];
    let target: { pos: number; attrs: Record<string, unknown> } | undefined;
    editor.state.doc.descendants((node, pos) => {
      nodes.push(`${node.type.name}${JSON.stringify(node.attrs)}`);
      if (!target && key in node.attrs) target = { pos, attrs: node.attrs };
      // #670's editable name duplicates the existing attribute. The historical
      // atom had no text child; saved and edited Markdown still compare exactly.
      if (node.type.name === 'mdxFile') {
        expect(node.textContent).toBe(node.attrs.name);
        return false;
      }
    });
    const saved = getMarkdown(editor);
    let edited: string | null = null;
    if (target) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, [key]: 'Edited' }));
      edited = getMarkdown(editor);
    }
    return { nodes, saved, edited };
  };
  const digest = (value: ReturnType<typeof result>): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

  /*
   * Main read a CR inside a component opener as written, before Markdown turned it
   * into LF: its nodes held the CR (`sourceOpen`), and an opener running over a CR
   * line could lose its closing tag. Since #702 the editor reads a page with LF
   * endings, keeping each line's ending aside, and a save puts them back. So a page
   * with a CR (the seeded `"a\r\nb"` and `"a\rb"` values, and nothing else) is
   * compared with main's result for the same page read with LF endings (`crAsLf`):
   * the same nodes, and the same saves once their endings are LF; and each save
   * holds the source's endings (an unedited page, byte for byte).
   */
  const CR_PAGES = 122;
  const crPages = pages.flatMap(({ page }, index) => (page.includes('\r') ? [index] : []));
  const lf = (markdown: string | null) => (markdown === null ? null : normalizeLineEndings(markdown));

  it(`has ${CR_PAGES} seeded pages with a CR`, () => {
    expect(crPages.length).toBe(CR_PAGES);
    expect(crPages.every((index) => index < seeded.length)).toBe(true);
  });

  it(`gives main’s nodes, save and edited save for all ${pages.length} pages, but #604’s`, () => {
    const recording = process.env.WRITE_BLANK_LINE_MAIN;
    const results = pages.map(({ page, key }, index) =>
      result(page, key, !recording && COMPONENT_LAYOUT_CORPUS_PAGES.includes(index - seeded.length)),
    );
    if (!recording) expect(componentLayouts).toBe(168);
    const digests = results.map(digest);
    if (process.env.WRITE_BLANK_LINE_MAIN) {
      const crAsLf = crPages.map((index) => digest(result(normalizeLineEndings(pages[index]?.page as string), pages[index]?.key as string)));
      writeFileSync(FIXTURE, `${JSON.stringify({ pages: pages.length, digests, crAsLf }, null, 2)}\n`);
      return;
    }
    const main = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { pages: number; digests: string[]; crAsLf: string[] };
    expect(main.pages).toBe(pages.length);
    expect(main.crAsLf.length).toBe(CR_PAGES);
    const crAsLf = new Map(crPages.map((index, at) => [index, main.crAsLf[at]]));
    const leadPages: number[] = [];
    const editBroken: number[] = [];
    const differences = digests.flatMap((value, index) => {
      const { page } = pages[index] as { page: string };
      if (value !== main.digests[index] && isNamed(page)) {
        leadPages.push(index);
        // Its attribute-edited save must still change only the attribute (attributeEditHolds).
        const { saved, edited } = results[index] as { saved: string; edited: string | null };
        if (!attributeEditHolds(attributesOf, saved, edited, pages[index]?.key ?? '', page)) editBroken.push(index);
        return [];
      }
      const lfDigest = crAsLf.get(index);
      if (lfDigest === undefined) return value === main.digests[index] ? [] : [page];
      const { nodes, saved, edited } = results[index] as ReturnType<typeof result>;
      const endings = readLineEndings(page);
      const kept =
        digest({ nodes, saved: lf(saved) as string, edited: lf(edited) }) === lfDigest &&
        saved === restoreLineEndings(endings, lf(saved) as string) &&
        (edited === null || edited === restoreLineEndings(endings, lf(edited) as string)) &&
        (lf(saved) !== normalizeLineEndings(page) || saved === page);
      return kept ? [] : [page];
    });
    console.info(
      `[blank-line-differential] ${pages.length} pages (${crPages.length} with a CR, read as LF on main), ${differences.length} differences, ${componentLayouts} replayed with main's #625 layout`,
    );
    expect(differences.slice(0, 3)).toEqual([]);
    const quotedPages = leadPages.filter((index) => quotedSources.has(pages[index]?.page ?? ''));
    expect(leadPages.filter((index) => !quotedPages.includes(index))).toEqual(
      pages.flatMap(({ page }, index) => (leadSources.has(page) ? [index] : [])),
    );
    expect(quotedPages.length).toBe(QUOTED_MARK_CHANGES);
    expect(editBroken, 'named pages whose attribute edit changes more than the attribute').toEqual([]);
  }, 600_000);
});
