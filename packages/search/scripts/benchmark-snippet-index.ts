import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { SearchDoc } from '../src/index';

// Run with node --expose-gc --import tsx. --module selects a historical source
// snapshot; fixture generation, dependencies and measurement stay identical.
const { values } = parseArgs({ options: { module: { type: 'string' }, snapshot: { type: 'string' }, reference: { type: 'string' } } });
const source = values.module ? pathToFileURL(values.module).href : new URL('../src/index.ts', import.meta.url).href;
const { createDocIndex, searchDocs, chunkSearchDocument, searchChunkSnippet } = (await import(source)) as typeof import('../src/index');
if (!global.gc) throw new Error('Run with --expose-gc to measure retained heap consistently.');
const collect = global.gc;

const measure = async (doc: SearchDoc, language: 'english' | 'arabic') => {
  collect();
  const before = process.memoryUsage();
  const start = performance.now();
  const index = await createDocIndex([doc], language);
  const elapsed = performance.now() - start;
  const built = process.memoryUsage();
  collect();
  const retained = process.memoryUsage();
  // Use the live index after collection; a truthiness check alone can let V8
  // discard it early. Returning only numbers drops it before the next sample.
  assert.ok((await searchDocs(index, 'SITE_BASE_DOMAIN')).length > 0);
  return {
    elapsed,
    retainedHeapMiB: (retained.heapUsed - before.heapUsed) / 2 ** 20,
    afterBuildHeapMiB: (built.heapUsed - before.heapUsed) / 2 ** 20,
    rssDeltaMiB: (built.rss - before.rss) / 2 ** 20,
  };
};

const page = (arabic: boolean, variant = 0): SearchDoc => {
  const title = arabic ? `دليل الإعدادات ${variant}` : `Settings guide ${variant}`;
  const row = (cells: string[], bordered: boolean) => `${bordered ? '| ' : ''}${cells.join(' | ')}${bordered ? ' |' : ''}`;
  const sections = Array.from({ length: 120 }, (_, section) => {
    const heading = `## ${arabic ? 'القسم' : 'Section'} ${section}`;
    const prose = arabic
      ? 'افتح لوحة التحكم واحفظ التغييرات. يدعم المشروع النشر وإدارة الإعدادات بأمان.'
      : 'Open the dashboard and save your changes. The project supports publishing and safe settings management.';
    const list = Array.from({ length: 5 }, (_, item) => `${item + 1}. ${prose} **confirm** __publish__ \`SITE_BASE_DOMAIN\``).join('\n');
    if (section % 6 !== 0) return `${heading}\n\n${prose}\n\n${list}`;
    const bordered = section % 12 === 0;
    const table = [
      row(
        Array.from({ length: 8 }, (_, column) => `${arabic ? 'الإعداد' : 'Setting'} ${column}`),
        bordered,
      ),
      row(
        Array.from({ length: 8 }, () => ':---'),
        bordered,
      ),
      ...Array.from({ length: 30 }, (_, record) =>
        row(
          Array.from({ length: 8 }, (_, column) =>
            (record + column) % 3 === 0
              ? `**نطاق** ${record} إعداد آمن [المشروع](/ar/project-${variant})`
              : `**domain** ${record} safe setting [project](/project-${variant})`,
          ),
          bordered,
        ),
      ),
    ].join('\n');
    // A real list continuation: nested tables coexist with long ordered lists.
    return `${heading}\n\n${list}\n\n- ${prose}\n\n${table
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}\n\n- ${prose}`;
  });
  return {
    id: `page-${variant}`,
    title,
    headings: sections.map((_, index) => `Section القسم ${index}`).join(' '),
    description: title,
    path: `guide-${variant}`,
    content: sections.join('\n\n'),
  };
};

const percentile = (samples: number[], fraction: number) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1];
const results: Record<string, unknown>[] = [];
const identity: Record<string, unknown> = {};
for (const language of ['english', 'arabic'] as const) {
  const docs = Array.from({ length: 3 }, (_, index) => page(language === 'arabic', index));
  const doc = docs[0];
  assert.ok(doc);
  const buildMs: number[] = [];
  const retainedHeapMiB: number[] = [];
  const afterBuildHeapMiB: number[] = [];
  const rssDeltaMiB: number[] = [];
  for (let run = 0; run < 11; run += 1) {
    const sample = await measure(doc, language);
    if (run >= 2) {
      buildMs.push(sample.elapsed);
      retainedHeapMiB.push(sample.retainedHeapMiB);
      afterBuildHeapMiB.push(sample.afterBuildHeapMiB);
      rssDeltaMiB.push(sample.rssDeltaMiB);
    }
  }
  const index = await createDocIndex(docs, language);
  const chunks = chunkSearchDocument(
    { projectId: 'fictional', deploymentId: 'local', versionSlug: 'main' },
    { ...doc, headings: [], visible: true, language: language === 'arabic' ? 'ar' : 'en' },
  );
  const queries = [
    'domain',
    'نطاق',
    'publish',
    '__publish__',
    'SITE_BASE_DOMAIN',
    'project',
    'project-1',
    'المشروع',
    'safe setting',
    'إعداد آمن',
    'publsh',
    'xqzv nonsense',
  ];
  for (const query of queries) {
    for (const relevance of [undefined, 'reader'] as const) {
      identity[`${language}/${relevance ?? 'default'}/${query}`] = await searchDocs(index, query, { relevance, limit: 12 });
    }
    identity[`${language}/stored/${query}`] = chunks.map((chunk) => searchChunkSnippet(chunk, query));
  }
  results.push({
    language,
    bytesPerPage: Buffer.byteLength(doc.content),
    fixtureSha256: createHash('sha256').update(JSON.stringify(docs)).digest('hex'),
    headings: 120,
    tables: 20,
    rowsPerTable: 30,
    columns: 8,
    warmups: 2,
    runs: buildMs.length,
    buildMs: { p50: percentile(buildMs, 0.5), p95: percentile(buildMs, 0.95) },
    retainedHeapMiB: { p50: percentile(retainedHeapMiB, 0.5), p95: percentile(retainedHeapMiB, 0.95) },
    afterBuildHeapMiB: { p50: percentile(afterBuildHeapMiB, 0.5), p95: percentile(afterBuildHeapMiB, 0.95) },
    rssDeltaMiB: { p50: percentile(rssDeltaMiB, 0.5), p95: percentile(rssDeltaMiB, 0.95) },
  });
}
const snapshot = JSON.stringify(identity);
if (values.reference) assert.deepEqual(identity, JSON.parse(readFileSync(values.reference, 'utf8')));
if (values.snapshot) writeFileSync(values.snapshot, snapshot);
process.stdout.write(
  `${JSON.stringify({ node: process.version, results, identityCases: Object.keys(identity).length, identitySha256: createHash('sha256').update(snapshot).digest('hex'), referenceMatched: Boolean(values.reference) }, null, 2)}\n`,
);
