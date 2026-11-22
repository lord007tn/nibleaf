// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STARTER_PAGE_CONTENTS } from '@nibleaf/auth/starter-content';
import { Editor, type JSONContent } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { COMPONENT_LAYOUT_CORPUS_PAGES, replayMainComponentLayout } from './__fixtures__/component-source-layout';
import { HARD_WRAPPED_AR, HARD_WRAPPED_EN, IMPORTED_INTRODUCTION, IMPORTED_QUICKSTART } from './__fixtures__/hard-wrapped-pages';
import { listItemLeadSources, quotedMarkSources, textChange } from './__fixtures__/list-item-leads';
import {
  applyCorpusEdits,
  CODE_TOGGLE_KEEPS_LINK_PAGES,
  type CorpusEdit,
  type DifferentialEditor,
  type MarkEditor,
  serializerCorpus,
  withMainCodeToggle,
} from './__fixtures__/serializer-corpus';
import { markdownToEmit } from './editor-change-origin';
import { SUPPORTED_MDX_COMPONENTS } from './extensions/mdx-roundtrip';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

type EditorModule = Pick<typeof import('./tiptap-editor'), 'buildEditorExtensions' | 'getMarkdown'>;

/*
 * #702 keeps a CRLF page's line endings and nothing else. A page with LF only
 * reads, saves and saves after an edit as on main: the same nodes, the same
 * save, the same edited save and the same Markdown emitted for the draft. The
 * pages: a seeded set built from every kind of block (prose, wrapped paragraphs,
 * fences with backticks and tildes in quotes, lists and components, tables,
 * lists, quotes, raw HTML, every registry component with a one-line and a
 * multiline attribute value), each with and without a last line break; the
 * serializer corpus's pages with their edits (#693); and the hard-wrapped,
 * imported and starter pages.
 *
 * `__fixtures__/lf-main.json` holds a digest of main's result for each page; it
 * was made by running this file against main's editor (main's
 * `markdown-output.ts` and `editor-change-origin.ts`, from `git show origin/main:`)
 * with `WRITE_LF_MAIN=1`. Regenerate it only when LF saving changes on purpose.
 *
 * One change is meant (#660): a link can now hold inline code, so toggling code
 * over part of a link keeps the link where main dropped it. The serializer
 * corpus's pages that do so (CODE_TOGGLE_KEEPS_LINK_PAGES, exactly 14) are
 * counted, and each one, replayed with main's code toggle, must still give
 * main's digest.
 */

const SEED = 0x70_2c_4f_1e;
const SEEDED_PAGES = 600;
const FIXTURE = resolve(import.meta.dirname, '__fixtures__/lf-main.json');

const COMPONENTS = Object.values(SUPPORTED_MDX_COMPONENTS).map((definition) => ({
  tag: definition.canonical,
  key: definition.attrs[0] ?? 'title',
  inline: Boolean(definition.inline),
}));

function seededPages(): string[] {
  let state = SEED;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const pick = <T>(values: readonly T[]): T => values[next() % values.length] as T;
  const component = () => {
    const { tag, key, inline } = pick(COMPONENTS);
    const value = pick(['"One line"', '"Line one\nline two"', "'Line one\nline two'", '{"x"}', '{`a\nb`}']);
    if (inline) return `Text <${tag} ${key}=${value} /> more.`;
    return pick([`<${tag} ${key}=${value} />`, `<${tag} ${key}=${value}>\n\nBody text\nwrapped.\n\n</${tag}>`]);
  };
  const BLOCKS: ReadonlyArray<() => string> = [
    () => pick(['# Title', '## Section', '### Smaller']),
    () => 'A paragraph with **bold**, `code` and a [link](/x).',
    () => 'A paragraph wrapped by hand, with **bold**\nat the end of a line and a [link](/a)\nbefore the last one.',
    () => 'Line one\\\nline two.',
    () => '```js\nconst a = 1;\n\nconst b = 2;\n```',
    () => '~~~python title="x.py"\nprint(1)\n~~~',
    () => '> Quoted.\n>\n> ```js\n> const a = 1;\n> ```',
    () => '- Item\n\n  ```js\n  const a = 1;\n  ```',
    () => '- ```js\n  const a = 1;\n  ```\n- Next',
    () => '<Note>\n\n~~~sh\nnpm install\n~~~\n\n</Note>',
    () => '| Name | Value |\n| --- | :---: |\n| a | 1 |',
    () => '- one\n- two\n  - nested\n  - wrapped\n    item',
    () => '1. first\n2. second',
    () => '- [ ] todo\n- [x] done',
    () => '> Quoted text\n> wrapped on two lines.',
    () => '<div class="note">\n  <b>Bold</b>\n</div>',
    () => '<Card\n  title="A card"\n  href="/x"\n>\n\nBody.\n\n</Card>',
    () => '---',
    () => '![Diagram](/diagram.png)',
    component,
    component,
  ];
  const pages: string[] = [];
  for (let index = 0; index < SEEDED_PAGES; index++) {
    const blocks = Array.from({ length: 2 + (next() % 6) }, () => pick(BLOCKS)());
    pages.push(blocks.join(pick(['\n\n', '\n\n', '\n'])) + pick(['', '\n', '\n\n']));
  }
  return pages;
}

const corpus = serializerCorpus();
/** #604: the corpus pages with a list item led by a quote, heading or list, and those whose
 *  quoted marks main doubled (QUOTED_MARK_PAGES), checked against main in
 *  list-item-leads-main.test.ts. */
const leadSources = listItemLeadSources();
const quotedSources = quotedMarkSources();
const isNamed = (page: string) => leadSources.has(page) || quotedSources.has(page);
/** The quoted mark pages whose saves here held a doubled mark on main: all 8. */
const QUOTED_MARK_CHANGES = 8;
/**
 * #604: the seeded pages with a list read as tight whose item holds a block the
 * serializer writes after a blank line (a lazy line read as a second paragraph, an HTML
 * block, a fence after text). Main wrote such a list tight with that blank line inside
 * the item, so it read back loose and the next save rewrote it; it is now written loose
 * (tight-lists.ts `writesTight`). For each, main's save unedited (`p`) and edited (`e`):
 * `F` when it was a fixed point (`.` when not), then the characters a reload of it lost (`-`) and added
 * (`+`, a delimiter read back as text; textChange). Each must be a fixed point where main's
 * was, and lose and add no more. Recorded from main's editor with LF_LOOSENED_BASELINE_DIR
 * (a copy of main's editor directory inside apps/app/src, as list-item-leads-main.generate.mjs makes).
 */
const LOOSENED_LIST_PAGES: Readonly<Record<number, string>> = {
  29: 'p:.-0+0 e:.-0+0',
  49: 'p:.-32+0 e:.-32+0',
  66: 'p:.-4+0 e:.-4+0',
  153: 'p:.-0+0 e:.-0+0',
  313: 'p:.-1+0 e:.-1+0',
  347: 'p:.-0+3 e:.-0+3',
  354: 'p:.-0+0 e:.-0+0',
  362: 'p:.-0+0 e:.-0+0',
  426: 'p:.-0+0 e:.-0+0',
  496: 'p:.-1+0 e:.-1+0',
  506: 'p:.-0+0 e:.-0+0',
  557: 'p:.-0+0 e:.-0+0',
  571: 'p:.-0+0 e:.-0+0',
};
/** Where the serializer corpus's pages start in `pages`. */
const CORPUS_START = SEEDED_PAGES;
// The LF suite has nine additional seeded pages with adjacent component tags.
const LF_COMPONENT_LAYOUT_PAGES = new Set([
  27,
  87,
  107,
  115,
  140,
  142,
  189,
  332,
  580,
  ...COMPONENT_LAYOUT_CORPUS_PAGES.map((index) => CORPUS_START + index),
]);
const pages: Array<{ page: string; edits: readonly CorpusEdit[] }> = [
  ...seededPages().map((page) => ({ page, edits: [{ kind: 'insert', at: 3, text: 'x' }] as CorpusEdit[] })),
  ...corpus.map(({ source, edits }) => ({ page: source, edits })),
  ...[HARD_WRAPPED_EN, HARD_WRAPPED_AR, IMPORTED_INTRODUCTION, IMPORTED_QUICKSTART, ...STARTER_PAGE_CONTENTS.map(({ content }) => content)].map(
    (page) => ({ page, edits: [{ kind: 'insert', at: 7, text: ' edited' }] as CorpusEdit[] }),
  ),
];

/** Project #670's duplicated File text and #575's unused metadata slot to the
 * historical shape. Authored values, every other node, and all Markdown remain
 * in the digest. */
const mainNodeShape = (node: JSONContent): JSONContent => {
  if (node.type === 'mdxFile') {
    expect(node.content?.map((child) => child.text ?? '').join('') ?? '').toBe(node.attrs?.name ?? '');
    const { content: _name, ...atom } = node;
    return atom;
  }
  let projected = node;
  if (node.attrs && Object.hasOwn(node.attrs, 'sourceStructuredHtml') && node.attrs.sourceStructuredHtml === undefined) {
    const { attrs, ...rest } = node;
    const { sourceStructuredHtml: _empty, ...existing } = attrs;
    projected = Object.keys(existing).length === 0 ? rest : { ...node, attrs: existing };
  }
  return node.content ? { ...projected, content: node.content.map(mainNodeShape) } : projected;
};

describe('pages with LF only save as on main (#702)', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());
  let componentLayouts = 0;

  const reader = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => reader.destroy());

  /** The page's nodes, its save, its save after `edits` (run through `edit`, the
   *  editor itself by default), and the Markdown the editor emits for that. */
  const digest = (
    page: string,
    edits: readonly CorpusEdit[],
    edit: (target: Editor) => DifferentialEditor = (target) => target as unknown as DifferentialEditor,
    replayLayout = false,
  ): string => {
    editor.commands.setContent(page, { emitUpdate: false });
    if (replayLayout && replayMainComponentLayout(editor)) componentLayouts++;
    const nodes = JSON.stringify(mainNodeShape(editor.state.doc.toJSON()));
    const saved = getMarkdown(editor);
    applyCorpusEdits(edit(editor), edits);
    const edited = getMarkdown(editor);
    const emitted = markdownToEmit({ source: page, serialized: saved }, edited);
    return createHash('sha256').update(JSON.stringify({ nodes, saved, edited, emitted })).digest('hex').slice(0, 16);
  };

  /** Whether the page's save, unedited (`p`) and after `edits` (`e`), is a fixed point (`F`),
   *  and how many characters a reload of it loses and adds (LOOSENED_LIST_PAGES): with this
   *  editor, or with `module`'s (main's, to record them). */
  const saveRecord = (page: string, edits: readonly CorpusEdit[], module?: EditorModule): string => {
    const own = module ? new Editor({ element: document.createElement('div'), extensions: module.buildEditorExtensions() }) : editor;
    const ownReader = module ? new Editor({ element: document.createElement('div'), extensions: module.buildEditorExtensions() }) : reader;
    const save = module ? module.getMarkdown : getMarkdown;
    try {
      return (['p', 'e'] as const)
        .map((kind) => {
          own.commands.setContent(page, { emitUpdate: false });
          if (kind === 'e') applyCorpusEdits(own as unknown as DifferentialEditor, edits);
          const text = own.state.doc.textContent;
          const saved = save(own);
          ownReader.commands.setContent(saved, { emitUpdate: false });
          const { lost, added } = textChange(text, ownReader.state.doc.textContent);
          const again = save(ownReader);
          ownReader.commands.setContent(again, { emitUpdate: false });
          return `${kind}:${again === saved && save(ownReader) === saved ? 'F' : '.'}-${lost}+${added}`;
        })
        .join(' ');
    } finally {
      if (module) {
        own.destroy();
        ownReader.destroy();
      }
    }
  };

  it.runIf(process.env.LF_LOOSENED_BASELINE_DIR)('prints main’s records for the loosened list pages', async () => {
    const dir = process.env.LF_LOOSENED_BASELINE_DIR as string;
    const module = (await import(/* @vite-ignore */ pathToFileURL(join(dir, 'tiptap-editor.tsx')).href)) as EditorModule;
    const records = Object.keys(LOOSENED_LIST_PAGES).map((index) => {
      const { page, edits } = pages[Number(index)] as (typeof pages)[number];
      return [index, saveRecord(page, edits, module)];
    });
    // Written out (LF_LOOSENED_OUT, or printed), for LOOSENED_LIST_PAGES.
    const out = JSON.stringify(Object.fromEntries(records), null, 2);
    if (process.env.LF_LOOSENED_OUT) writeFileSync(process.env.LF_LOOSENED_OUT, `${out}\n`);
    else console.info(`[lf-main-differential] main's loosened list records: ${out}`);
  }, 120_000);

  it('the pages are LF only', () => {
    expect(pages.filter(({ page }) => page.includes('\r'))).toEqual([]);
  });

  it(`gives main’s nodes, save, edited save and emitted Markdown for all ${pages.length} pages, but #660’s and #604’s`, () => {
    const digests = pages.map(({ page, edits }, index) =>
      digest(page, edits, undefined, !process.env.WRITE_LF_MAIN && LF_COMPONENT_LAYOUT_PAGES.has(index)),
    );
    if (!process.env.WRITE_LF_MAIN) expect(componentLayouts).toBe(177);
    if (process.env.WRITE_LF_MAIN) {
      writeFileSync(FIXTURE, `${JSON.stringify({ pages: pages.length, digests }, null, 2)}\n`);
      return;
    }
    const main = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { pages: number; digests: string[] };
    expect(main.pages).toBe(pages.length);
    const changed = digests.flatMap((value, index) => (value === main.digests[index] ? [] : [index]));
    // #604: the corpus pages with a list item lead or a quoted mark, checked in list-item-leads-main.test.ts.
    const leadPages = changed.filter((index) => isNamed(pages[index]?.page ?? ''));
    const quotedPages = leadPages.filter((index) => quotedSources.has(pages[index]?.page ?? ''));
    expect(leadPages.filter((index) => !quotedPages.includes(index))).toEqual(
      pages.flatMap(({ page }, index) => (leadSources.has(page) ? [index] : [])),
    );
    expect(quotedPages.length).toBe(QUOTED_MARK_CHANGES);
    // #604: the seeded pages whose tight list is now written loose (LOOSENED_LIST_PAGES).
    const loosened = changed.filter((index) => index in LOOSENED_LIST_PAGES);
    expect(loosened).toEqual(Object.keys(LOOSENED_LIST_PAGES).map(Number));
    const worse = loosened.flatMap((index) => {
      const { page, edits } = pages[index] as (typeof pages)[number];
      const now = saveRecord(page, edits).split(' ');
      return (LOOSENED_LIST_PAGES[index] as string).split(' ').some((before, at) => {
        const [, fixedBefore, lostBefore, addedBefore] = /^.:(.)-(d+)+(d+)$/.exec(before) ?? [];
        const [, fixedNow, lostNow, addedNow] = /^.:(.)-(d+)+(d+)$/.exec(now[at] ?? '') ?? [];
        if (fixedBefore === undefined || fixedNow === undefined) throw new Error(`Unreadable record ${before} or ${now[at]}`);
        return (fixedBefore === 'F' && fixedNow !== 'F') || Number(lostNow) > Number(lostBefore) || Number(addedNow) > Number(addedBefore);
      })
        ? [{ index, now: now.join(' '), main: LOOSENED_LIST_PAGES[index] }]
        : [];
    });
    expect(worse, JSON.stringify(worse)).toEqual([]);
    // #660: the corpus pages whose code toggle now keeps a link; with main's toggle each gives main's digest.
    const keptLink = CODE_TOGGLE_KEEPS_LINK_PAGES.map((index) => CORPUS_START + index).filter((index) => !leadPages.includes(index));
    const differences = changed.filter((index) => !keptLink.includes(index) && !leadPages.includes(index) && !loosened.includes(index));
    console.info(
      `[lf-main-differential] ${pages.length} pages, ${differences.length} differences, ${keptLink.length} kept links by #660, ${leadPages.length} list item lead and ${loosened.length} loosened list pages by #604, ${componentLayouts} replayed with main's #625 layout`,
    );
    expect(differences.slice(0, 3).map((index) => pages[index]?.page)).toEqual([]);
    expect(changed.filter((index) => !leadPages.includes(index) && !loosened.includes(index))).toEqual(keptLink);
    expect(keptLink.length + CODE_TOGGLE_KEEPS_LINK_PAGES.filter((index) => leadPages.includes(CORPUS_START + index)).length).toBe(14);
    const withMainToggle = keptLink.map((index) => {
      const { page, edits } = pages[index] as (typeof pages)[number];
      return digest(page, edits, (target) => withMainCodeToggle(target as unknown as MarkEditor), LF_COMPONENT_LAYOUT_PAGES.has(index));
    });
    expect(withMainToggle).toEqual(keptLink.map((index) => main.digests[index]));
  }, 600_000);
});
