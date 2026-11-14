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
import { describe, expect, it, vi } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { readerSections } from './reader-headings';
import { extractHeadings } from './site';
import { AFTER_FENCE, FENCE_CONTAINER_REPROS } from './testing/fence-cases';
import { mainFencedMarkdownLines } from './testing/markdown-code.main-reference';
import { markdownCorpus } from './testing/markdown-corpus';

// Some tests here work through large generated case sets or whole documentation
// corpora. On a loaded CI runner such tests have taken ~28x as long as on a laptop
// (5.5 s against 0.19 s), past Vitest's 5 s default, so the file gets an explicit
// timeout. Their cost stays linear; the *.growth.test.ts files pin that.
vi.setConfig({ testTimeout: 60_000 });

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

describe('the repository Markdown corpus against main 93408093 (#587)', () => {
  // No exact counts here: docs edits and new pages are skipped, never failures.
  it('leaves every ordinary page as main read it', async ({ annotate }) => {
    // Main lost the heading after #587's first repro: the hashes are main's output.
    expect(main.guard).toEqual({ reproHeadings: 0, reproSections: 0 });
    const report = compareWithMain(markdownCorpus(root), main);
    const skipped = [...report.edited.map((name) => `edited: ${name}`), ...report.added.map((name) => `new: ${name}`)];
    const summary =
      `fence corpus: ${report.compared} pages compared with main ${main.revision.slice(0, 8)}, ${report.differing.length} differ; ` +
      `${skipped.length} skipped (${report.edited.length} edited, ${report.added.length} new), ${report.deleted.length} deleted`;
    console.info(summary, { skipped, deleted: report.deleted, differing: report.differing });
    await annotate(skipped.length ? `${summary}\n${skipped.join('\n')}` : summary);
    // Only a page where main's fence never closed may read differently now.
    expect(report.differing.filter(({ reason }) => reason !== OVERRAN)).toEqual([]);
  });
});

describe('comparing a corpus with a recorded fixture', () => {
  // A small, self-contained fixture and corpus, so these checks never depend on
  // the repository's pages. Main's output for each page is recorded with main's
  // scanner; the heading APIs read it only through the fence flags, and the one
  // page main overran (#587's first repro) records main's empty headings.
  const repro = `${FENCE_CONTAINER_REPROS[0]?.[1]}${AFTER_FENCE}`;
  const pages: Array<[string, string]> = [
    ...Array.from({ length: 9 }, (_, index): [string, string] => [
      `docs/page-${index}.md`,
      `# Page ${index}\n\nText.\n\n\`\`\`js\n# not a heading\n\`\`\`\n`,
    ]),
    ['docs/overran.md', repro],
  ];
  const record = (source: string): MainPage => {
    const lines = source.split('\n');
    const overran = Boolean(mainFencedMarkdownLines([...lines, '']).at(-1));
    return {
      source: hash(source),
      lines: hash(mainFencedMarkdownLines(lines).map(Number).join('')),
      headings: hash(JSON.stringify(overran ? [] : extractHeadings(source))),
      sections: hash(JSON.stringify(overran ? [] : readerSections(source))),
      open: overran,
    };
  };
  const fixture: MainFixture = {
    revision: 'synthetic',
    guard: { reproHeadings: 0, reproSections: 0 },
    pages: Object.fromEntries(pages.map(([name, source]) => [name, record(source)])),
  };
  const edit = (count: number) => pages.map(([name, source], index): [string, string] => [name, index < count ? `${source}\nAn edit.\n` : source]);

  it('compares every recorded page, and allows a difference only where main overran', () => {
    const report = compareWithMain(pages, fixture);
    expect(report).toEqual({
      compared: 10,
      edited: [],
      added: [],
      deleted: [],
      differing: [{ name: 'docs/overran.md', reason: OVERRAN, outputs: ['fence lines', 'extractHeadings', 'readerSections'] }],
    });
  });

  it('skips and lists an edited page, and still passes', () => {
    const report = compareWithMain(edit(1), fixture);
    expect([report.edited, report.compared]).toEqual([['docs/page-0.md'], 9]);
  });

  it('skips and lists a new page, and still passes', () => {
    const report = compareWithMain([...pages, ['docs/a-new-page.md', '# A new page\n']], fixture);
    expect([report.added, report.compared]).toEqual([['docs/a-new-page.md'], 10]);
  });

  it('accepts a fixture with up to 20% of its pages edited or deleted', () => {
    expect(compareWithMain(edit(2), fixture).edited).toHaveLength(2);
    expect(compareWithMain(pages.slice(2), fixture).deleted).toEqual(['docs/page-0.md', 'docs/page-1.md']);
  });

  it('fails with the regenerate command when more than 20% of the fixture is edited or deleted', () => {
    expect(STALE_FIXTURE_LIMIT).toBe(0.2);
    expect(() => compareWithMain(edit(3), fixture)).toThrow(REGENERATE);
    expect(() => compareWithMain(pages.slice(3), fixture)).toThrow(REGENERATE);
    expect(() => compareWithMain([...edit(2).slice(0, 9)], fixture)).toThrow(REGENERATE);
  });
});
