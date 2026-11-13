/**
 * Ordinary pages read as main read them (#587). Main 93408093's fence lines,
 * extractHeadings and readerSections for every page of the repository's
 * Markdown corpus are recorded, as hashes, in
 * __fixtures__/markdown-code.corpus.main-93408093.json. Regenerate it with:
 *
 *   node --import tsx packages/shared/src/__fixtures__/markdown-code.corpus.generate.mjs
 *
 * The fixture exists only for #587's transition, so a docs edit never fails this
 * test by itself: a page whose content is not in the fixture (edited or new) is
 * skipped and listed. Only when too much of the fixture is stale does the test
 * fail, asking for that command.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { readerSections } from './reader-headings';
import { extractHeadings } from './site';
import { markdownCorpus } from './testing/markdown-corpus';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const REGENERATE = 'node --import tsx packages/shared/src/__fixtures__/markdown-code.corpus.generate.mjs';
/** More than this share of the fixture's pages edited or deleted fails the test: a stale fixture must not silently cover nothing. */
const STALE_FIXTURE_LIMIT = 0.2;
const OVERRAN = 'main overran to the end of the page';

interface MainPage {
  source: string;
  lines: string;
  headings: string;
  sections: string;
  open: boolean;
}
interface MainFixture {
  revision: string;
  guard: { reproHeadings: number; reproSections: number };
  pages: Record<string, MainPage>;
}
/** Main 93408093's output for every page, recorded by the script in REGENERATE. */
const main = JSON.parse(readFileSync(new URL('./__fixtures__/markdown-code.corpus.main-93408093.json', import.meta.url), 'utf8')) as MainFixture;
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

interface CorpusReport {
  compared: number;
  /** Skipped: pages whose content is not in the fixture. */
  edited: string[];
  added: string[];
  /** Recorded pages no longer in the corpus. */
  deleted: string[];
  differing: Array<{ name: string; reason: string; outputs: string[] }>;
}

/** Compares the current scanner with main's recorded output on every page whose
 * content the fixture recorded. Throws when the fixture is too stale to cover the corpus. */
const compareWithMain = (documents: ReadonlyArray<readonly [string, string]>, fixture: MainFixture): CorpusReport => {
  const report: CorpusReport = { compared: 0, edited: [], added: [], deleted: [], differing: [] };
  const comparable: Array<[string, string, MainPage]> = [];
  for (const [name, source] of documents) {
    const page = fixture.pages[name];
    if (!page) report.added.push(name);
    else if (page.source !== hash(source)) report.edited.push(name);
    else comparable.push([name, source, page]);
  }
  const names = new Set(documents.map(([name]) => name));
  report.deleted = Object.keys(fixture.pages).filter((name) => !names.has(name));
  const recorded = Object.keys(fixture.pages).length;
  const stale = report.edited.length + report.deleted.length;
  if (stale > STALE_FIXTURE_LIMIT * recorded)
    throw new Error(
      `${stale} of the fixture's ${recorded} pages were edited or deleted (more than ${STALE_FIXTURE_LIMIT * 100}%), ` +
        `so it no longer covers the corpus. Regenerate main's output with \`${REGENERATE}\`.`,
    );
  for (const [name, source, page] of comparable) {
    report.compared++;
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
    report.differing.push({ name, reason: overran ? OVERRAN : 'other', outputs });
  }
  return report;
};

let corpus: Array<[string, string]> | undefined;
const repositoryCorpus = () => {
  corpus ??= markdownCorpus(root);
  return corpus;
};

describe('the repository Markdown corpus against main 93408093 (#587)', () => {
  it('leaves every ordinary page as main read it', async ({ annotate }) => {
    // Main lost the heading after #587's first repro: the hashes are main's output.
    expect(main.guard).toEqual({ reproHeadings: 0, reproSections: 0 });
    const report = compareWithMain(repositoryCorpus(), main);
    const skipped = [...report.edited.map((name) => `edited: ${name}`), ...report.added.map((name) => `new: ${name}`)];
    const summary =
      `fence corpus: ${report.compared} pages compared with main ${main.revision.slice(0, 8)}, ${report.differing.length} differ; ` +
      `${skipped.length} skipped (${report.edited.length} edited, ${report.added.length} new), ${report.deleted.length} deleted`;
    console.info(summary, { skipped, deleted: report.deleted, differing: report.differing });
    await annotate(skipped.length ? `${summary}\n${skipped.join('\n')}` : summary);
    expect(report.compared).toBeGreaterThan(0);
    // Only a page where main's fence never closed may read differently now.
    expect(report.differing.filter(({ reason }) => reason !== OVERRAN)).toEqual([]);
  });

  it('skips and lists an edited page, and still passes', () => {
    const [first, ...rest] = repositoryCorpus();
    if (!first) throw new Error('empty corpus');
    const report = compareWithMain([[first[0], `${first[1]}\n\nAn edit.\n`], ...rest], main);
    expect(report.edited).toEqual([first[0]]);
    expect(report.compared).toBe(rest.length);
    expect(report.differing.filter(({ reason }) => reason !== OVERRAN)).toEqual([]);
  });

  it('skips and lists a new page, and still passes', () => {
    const report = compareWithMain([...repositoryCorpus(), ['docs/a-new-page.md', '# A new page\n\n```js\ncode\n```\n']], main);
    expect(report.added).toEqual(['docs/a-new-page.md']);
    expect(report.compared).toBe(repositoryCorpus().length);
  });

  it('fails with the regenerate command when more than 20% of the fixture is stale', () => {
    const documents = repositoryCorpus();
    const stale = Math.floor(documents.length * STALE_FIXTURE_LIMIT) + 1;
    const edited = documents.slice(0, stale).map(([name, source]): [string, string] => [name, `${source}\nAn edit.`]);
    expect(() => compareWithMain([...edited, ...documents.slice(stale)], main)).toThrow(REGENERATE);
    // Deleted pages count the same way.
    expect(() => compareWithMain(documents.slice(stale), main)).toThrow(REGENERATE);
    // At the limit, it still compares the rest.
    const atLimit = Math.floor(Object.keys(main.pages).length * STALE_FIXTURE_LIMIT);
    expect(compareWithMain(documents.slice(atLimit), main).deleted).toHaveLength(atLimit);
  });
});
