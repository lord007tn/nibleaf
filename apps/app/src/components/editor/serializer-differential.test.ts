// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';
import { LIST_ITEM_EDIT_REPAIR_INDICES, LIST_ITEM_MAIN_TOGGLE_OVERLAP, repairedListItem } from './__fixtures__/list-item-first-block';
import {
  applyCorpusEdits,
  CODE_TOGGLE_KEEPS_LINK_PAGES,
  type DifferentialEditor,
  type MarkEditor,
  SERIALIZER_CORPUS_SEED,
  SERIALIZER_CORPUS_SIZE,
  serializerCorpus,
  withMainCodeToggle,
} from './__fixtures__/serializer-corpus';

/*
 * The serializer differential (#612): every page of the seeded corpus, loaded and
 * edited as a writer would, must save to exactly the Markdown main's serializer
 * wrote for it. The fixture holds a hash of main's output for each page, recorded
 * by running main's own editor code (__fixtures__/serializer-differential.generate.mjs,
 * which sets SERIALIZER_BASELINE_DIR and runs this file to record).
 *
 * One change is meant (#660): a link can now hold inline code, so toggling code
 * over part of a link keeps the link where main dropped it. The pages that do so
 * (CODE_TOGGLE_KEEPS_LINK_PAGES, exactly 14) are counted, and each one, replayed
 * with main's code toggle, must still save exactly as main did.
 * #604 adds 14 named list-prefix repairs, one overlapping #660. Their pinned
 * main bytes and the permitted prefix edits live in list-item-first-block-main.json.
 */

interface SerializerBaseline {
  revision: string;
  seed: number;
  sources: string;
  outputs: string[];
}

// A path, not a URL: jsdom replaces the global URL, which node:fs does not accept.
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/serializer-differential.main-d93468d6.json');
const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const cases = serializerCorpus();
const sources = createHash('sha256')
  .update(cases.map(({ source, edits }) => `${source}\0${JSON.stringify(edits)}`).join('\0\0'))
  .digest('hex');

type EditorModule = Pick<typeof import('./tiptap-editor'), 'buildEditorExtensions' | 'getMarkdown'>;

/** Each corpus page loaded, edited and saved, hashed: all of them, or the `indexes`
 *  given, with the edits run through `edit` (the editor itself by default). */
const saveAll = async (
  module: EditorModule,
  indexes: readonly number[] = cases.map((_, index) => index),
  edit: (editor: Editor) => DifferentialEditor = (editor) => editor as unknown as DifferentialEditor,
): Promise<string[]> => {
  const editor = new Editor({ element: document.createElement('div'), extensions: module.buildEditorExtensions() });
  try {
    return indexes.map((index) => {
      const { source, edits } = cases[index] as (typeof cases)[number];
      editor.commands.setContent(source, { emitUpdate: false });
      applyCorpusEdits(edit(editor), edits);
      return hash(module.getMarkdown(editor));
    });
  } finally {
    editor.destroy();
  }
};

const baselineDir = process.env.SERIALIZER_BASELINE_DIR;

it.runIf(baselineDir)(
  'records main serializer output for the corpus',
  async () => {
    const module = (await import(/* @vite-ignore */ pathToFileURL(join(baselineDir as string, 'tiptap-editor.tsx')).href)) as EditorModule;
    const baseline: SerializerBaseline = {
      revision: process.env.SERIALIZER_BASELINE_REVISION ?? '',
      seed: SERIALIZER_CORPUS_SEED,
      sources,
      outputs: await saveAll(module),
    };
    writeFileSync(process.env.SERIALIZER_BASELINE_OUT ?? FIXTURE, `${JSON.stringify(baseline)}\n`);
  },
  600_000,
);

// A thousand pages loaded, edited and saved: about 30 s on a laptop, so the test
// gets its own timeout, well past what a loaded CI runner needs (#658). Saving
// stays linear; serializer-work.test.ts and the *.growth.test.ts rows pin that.
it.skipIf(baselineDir)(
  `saves every corpus page byte for byte as main does (${SERIALIZER_CORPUS_SIZE} pages), with named #660 and #604 repairs`,
  async () => {
    const baseline = JSON.parse(readFileSync(FIXTURE, 'utf8')) as SerializerBaseline;
    expect({ seed: baseline.seed, sources: baseline.sources, count: baseline.outputs.length }).toEqual({
      seed: SERIALIZER_CORPUS_SEED,
      sources,
      count: cases.length,
    });
    const module = await import('./tiptap-editor');
    const outputs = await saveAll(module);
    const differing = outputs.flatMap((output, index) => (output === baseline.outputs[index] ? [] : [index]));
    // #604's named prefix repairs that survive the corpus edits are checked bytewise
    // against pinned main output in list-item-first-block-differential.test.ts. Page
    // 550 overlaps #660.
    const expected = [...new Set([...CODE_TOGGLE_KEEPS_LINK_PAGES, ...LIST_ITEM_EDIT_REPAIR_INDICES])].sort((a, b) => a - b);
    expect(differing, `${differing.length} pages save differently from main`).toEqual(expected);
    const withMainToggle = await saveAll(module, CODE_TOGGLE_KEEPS_LINK_PAGES, (editor) => withMainCodeToggle(editor as unknown as MarkEditor));
    expect(baseline.outputs[550]).toBe(LIST_ITEM_MAIN_TOGGLE_OVERLAP.mainSerializerDigest);
    expect(withMainToggle).toEqual(
      CODE_TOGGLE_KEEPS_LINK_PAGES.map((index) =>
        index === LIST_ITEM_MAIN_TOGGLE_OVERLAP.index ? hash(repairedListItem(LIST_ITEM_MAIN_TOGGLE_OVERLAP.corpusEdit)) : baseline.outputs[index],
      ),
    );
  },
  600_000,
);
