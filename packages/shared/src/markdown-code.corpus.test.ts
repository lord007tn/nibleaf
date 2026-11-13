import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { readerSections } from './reader-headings';
import { extractHeadings } from './site';
import { markdownCorpus } from './testing/markdown-corpus';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const REGENERATE = 'node --import tsx packages/shared/src/__fixtures__/markdown-code.corpus.generate.mjs';

interface MainPage {
  source: string;
  lines: string;
  headings: string;
  sections: string;
  open: boolean;
}
/** Main 93408093's output for every page, recorded by the script in REGENERATE. */
const main = JSON.parse(readFileSync(new URL('./__fixtures__/markdown-code.corpus.main-93408093.json', import.meta.url), 'utf8')) as {
  revision: string;
  guard: { reproHeadings: number; reproSections: number };
  pages: Record<string, MainPage>;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

it('leaves every ordinary page in the repository as main read it (#587)', () => {
  // Main lost the heading after #587's first repro: the hashes are main's output.
  expect(main.guard).toEqual({ reproHeadings: 0, reproSections: 0 });

  const documents = markdownCorpus(root);
  const names = new Set(documents.map(([name]) => name));
  const pageSet = {
    added: [...names].filter((name) => !main.pages[name]),
    removed: Object.keys(main.pages).filter((name) => !names.has(name)),
    changed: documents.filter(([name, source]) => main.pages[name] && main.pages[name].source !== hash(source)).map(([name]) => name),
  };
  expect(pageSet, `The Markdown corpus changed: regenerate main's output with \`${REGENERATE}\``).toEqual({ added: [], removed: [], changed: [] });
  expect(documents.length).toBeGreaterThan(300);

  const differing: Array<{ name: string; reason: string; outputs: string[] }> = [];
  for (const [name, source] of documents) {
    const page = main.pages[name] as MainPage;
    const lines = source.split('\n');
    const sameLines = hash(fencedMarkdownLines(lines).map(Number).join('')) === page.lines;
    const sameHeadings = hash(JSON.stringify(extractHeadings(source))) === page.headings;
    // readerSections reads the scanner only through fencedMarkdownLines on these
    // same lines, so with identical flags it cannot differ; its full parse (the
    // slow part) runs only for a page whose flags changed.
    if (sameLines && sameHeadings) continue;
    const sameSections = hash(JSON.stringify(readerSections(source))) === page.sections;
    const overran = page.open && !fencedMarkdownLines([...lines, '']).at(-1);
    const outputs = [!sameLines && 'fence lines', !sameHeadings && 'extractHeadings', !sameSections && 'readerSections'].filter(
      (output): output is string => Boolean(output),
    );
    differing.push({ name, reason: overran ? 'main overran to the end of the page' : 'other', outputs });
  }
  console.info(`fence corpus: ${documents.length} documents, ${differing.length} differ from main ${main.revision.slice(0, 8)}`, differing);
  // Only a page where main's fence never closed may read differently now.
  expect(differing.filter(({ reason }) => reason !== 'main overran to the end of the page')).toEqual([]);
});
