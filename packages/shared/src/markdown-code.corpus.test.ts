import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { AFTER_FENCE, FENCE_CONTAINER_REPROS } from './testing/fence-cases';
import { mainFencedMarkdownLines } from './testing/markdown-code.main-reference';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Every Markdown page in the repository: tracked .md/.mdx files (docs, blog,
 * guides, fixtures, READMEs), the starter pages in every locale, and the
 * multi-line strings of the shared JSON fixtures (component examples). */
const corpus = (): Array<[name: string, source: string]> => {
  const files = execFileSync('git', ['ls-files', '-z', '--', '*.md', '*.mdx'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0')
    .filter(Boolean);
  const documents: Array<[string, string]> = files.map((path) => [path, read(path)]);
  for (const file of readdirSync(join(root, 'packages/i18n/messages')).filter((name) => name.endsWith('.json'))) {
    const messages = JSON.parse(read(`packages/i18n/messages/${file}`)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(messages))
      if (/^newsite_starter_\w+_content$/.test(key) && typeof value === 'string') documents.push([`${file}#${key}`, value]);
  }
  const starter = /STARTER_GETTING_STARTED_CONTENT = `([^`]*)`/.exec(read('packages/auth/src/starter-content.ts'))?.[1];
  if (starter) documents.push(['packages/auth/src/starter-content.ts#STARTER_GETTING_STARTED_CONTENT', starter]);
  const strings = (value: unknown, at: string): void => {
    if (typeof value === 'string' && value.includes('\n')) documents.push([at, value]);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) strings(child, `${at}.${key}`);
  };
  for (const file of readdirSync(join(root, 'packages/shared/src/__fixtures__')).filter((name) => name.endsWith('.json')))
    strings(JSON.parse(read(`packages/shared/src/__fixtures__/${file}`)), `packages/shared/src/__fixtures__/${file}`);
  return documents;
};

/** Whether a scanner leaves a fence open at the end of the document. */
const leftOpen = (scan: (lines: readonly string[]) => boolean[], source: string) => Boolean(scan([...source.split('\n'), '']).at(-1));

type HeadingModules = { extractHeadings: (source: string) => unknown[]; readerSections: (source: string) => unknown[] };
const headingModules = async (): Promise<HeadingModules> => {
  const [{ extractHeadings }, { readerSections }] = await Promise.all([import('./site'), import('./reader-headings')]);
  return { extractHeadings, readerSections };
};

it('leaves every ordinary page in the repository as main read it (#587)', async () => {
  const current = await headingModules();
  vi.resetModules();
  vi.doMock('./markdown-code', async (original) => ({
    ...(await original<typeof import('./markdown-code')>()),
    fencedMarkdownLines: mainFencedMarkdownLines,
  }));
  const main = await headingModules();
  vi.doUnmock('./markdown-code');
  vi.resetModules();
  // The two module sets really differ: main loses #587's heading, the fix keeps it.
  const repro = `${FENCE_CONTAINER_REPROS[0]?.[1]}${AFTER_FENCE}`;
  expect([main.extractHeadings(repro), main.readerSections(repro)]).toEqual([[], []]);
  expect([current.extractHeadings(repro).length, current.readerSections(repro).length]).toEqual([1, 1]);

  const documents = corpus();
  expect(documents.length).toBeGreaterThan(250);
  const differing: Array<{ name: string; reason: string }> = [];
  for (const [name, source] of documents) {
    const lines = source.split('\n');
    const same =
      JSON.stringify(fencedMarkdownLines(lines)) === JSON.stringify(mainFencedMarkdownLines(lines)) &&
      JSON.stringify(current.extractHeadings(source)) === JSON.stringify(main.extractHeadings(source)) &&
      JSON.stringify(current.readerSections(source)) === JSON.stringify(main.readerSections(source));
    if (same) continue;
    const overran = leftOpen(mainFencedMarkdownLines, source) && !leftOpen(fencedMarkdownLines, source);
    differing.push({ name, reason: overran ? 'main overran to the end of the page' : 'other' });
  }
  console.info(`fence corpus: ${documents.length} documents, ${differing.length} differ`, differing);
  // Only a page where main's fence never closed may read differently now.
  expect(differing.filter(({ reason }) => reason !== 'main overran to the end of the page')).toEqual([]);
}, 60_000);
