// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';
import {
  applyCorpusEdits,
  type DifferentialEditor,
  SERIALIZER_CORPUS_SEED,
  SERIALIZER_CORPUS_SIZE,
  serializerCorpus,
} from './__fixtures__/serializer-corpus';

/*
 * The serializer differential (#612): every page of the seeded corpus, loaded and
 * edited as a writer would, must save to exactly the Markdown main's serializer
 * wrote for it. The fixture holds a hash of main's output for each page, recorded
 * by running main's own editor code (__fixtures__/serializer-differential.generate.mjs,
 * which sets SERIALIZER_BASELINE_DIR and runs this file to record).
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

const saveAll = async (module: EditorModule): Promise<string[]> => {
  const editor = new Editor({ element: document.createElement('div'), extensions: module.buildEditorExtensions() });
  try {
    return cases.map(({ source, edits }) => {
      editor.commands.setContent(source, { emitUpdate: false });
      applyCorpusEdits(editor as unknown as DifferentialEditor, edits);
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
  `saves every corpus page byte for byte as main does (${SERIALIZER_CORPUS_SIZE} pages)`,
  async () => {
    const baseline = JSON.parse(readFileSync(FIXTURE, 'utf8')) as SerializerBaseline;
    expect({ seed: baseline.seed, sources: baseline.sources, count: baseline.outputs.length }).toEqual({
      seed: SERIALIZER_CORPUS_SEED,
      sources,
      count: cases.length,
    });
    const outputs = await saveAll(await import('./tiptap-editor'));
    const differing = outputs.flatMap((output, index) => (output === baseline.outputs[index] ? [] : [index]));
    expect(differing, `${differing.length} pages save differently from main`).toEqual([]);
  },
  600_000,
);
