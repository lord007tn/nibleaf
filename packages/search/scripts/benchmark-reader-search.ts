import { performance } from 'node:perf_hooks';
import { cleanSearchText, createDocIndex, readerSearchTerms, type SearchDoc, searchDocs } from '../src/index';

// Deterministic 300-page EN+AR deployment. No services, network or query cache.
const topics = [
  ['Cancel reservation', 'إلغاء الحجز'],
  ['Invoice', 'الفاتورة'],
  ['Add new hotel', 'إضافة فندق جديد'],
  ['Agent commission', 'عمولة الوكيل'],
  ['WhatsApp', 'واتساب'],
  ['Reports', 'التقارير'],
] as const;
const queries = [
  'cancel reservation',
  'invoice',
  'add new hotel',
  'agent commission',
  'whatsapp',
  'password',
  'إلغاء الحجز',
  'الفاتورة',
  'xqzv nonsense',
];
const docs = (language: 'en' | 'ar'): SearchDoc[] =>
  Array.from({ length: 150 }, (_, index) => {
    const title = topics[index % topics.length]?.[language === 'en' ? 0 : 1] ?? '';
    return {
      id: `${language}-${index}`,
      title: `${title} ${index}`,
      path: `${language}/guide-${index}`,
      description: '',
      headings: title,
      content: Array.from({ length: 20 }, (_, section) =>
        `## ${title} ${section}\n\n${language === 'en' ? 'Open the dashboard and select the record. Follow these steps to update the settings and save your changes. ' : 'افتح لوحة التحكم واختر السجل. اتبع الخطوات لتحديث الإعدادات وحفظ التغييرات. '}`.repeat(
          4,
        ),
      ).join('\n\n'),
    };
  });
const snapshot = JSON.stringify({ en: docs('en'), ar: docs('ar') });
const started = performance.now();
const parsed = JSON.parse(snapshot) as { en: SearchDoc[]; ar: SearchDoc[] };
const parseMs = performance.now() - started;
const buildStarted = performance.now();
const indexes = await Promise.all([createDocIndex(parsed.en, 'english'), createDocIndex(parsed.ar, 'arabic')]);
const buildMs = performance.now() - buildStarted;
const samples: number[] = [];
const counts: Record<string, number> = {};
const reader = process.argv.includes('--reader');
for (let round = 0; round < 12; round += 1) {
  for (const query of queries) {
    const at = performance.now();
    const hits = await Promise.all(
      indexes.map((index) => searchDocs(index, query, { limit: 12, ...(reader ? { relevance: 'reader' as const } : {}) })),
    );
    if (round > 1) samples.push(performance.now() - at);
    counts[query] = hits.flat().length;
  }
}
samples.sort((a, b) => a - b);

// Request-guard latency, measured here instead of asserted in unit tests: an
// oversized query is refused before retrieval, and 100k-character hostile text
// is normalized on the linear path.
const timed = async (run: () => unknown): Promise<number> => {
  await run();
  const at = performance.now();
  await run();
  return performance.now() - at;
};
const hostile = {
  spaces: `${' '.repeat(99_999)}x`,
  comments: '<!--'.repeat(25_000),
  backticks: '`a``'.repeat(25_000),
  fences: '```\n'.repeat(25_000),
};
const guards: Record<string, number> = {
  oversizedQueryMs: await timed(() => (indexes[0] ? searchDocs(indexes[0], 'invoice '.repeat(12_500), { relevance: 'reader' }) : undefined)),
};
for (const [name, input] of Object.entries(hostile)) {
  guards[`${name}NormalizeMs`] = await timed(() => {
    readerSearchTerms(input);
    cleanSearchText(input);
  });
}
process.stdout.write(
  `${JSON.stringify({ pages: 300, bytes: Buffer.byteLength(snapshot), samples: samples.length, parseMs, buildMs, p50Ms: samples[Math.floor(samples.length * 0.5)], p95Ms: samples[Math.floor(samples.length * 0.95)], maxMs: samples.at(-1), counts, guards }, null, 2)}\n`,
);
