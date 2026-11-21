import { performance } from 'node:perf_hooks';
import { cleanSearchText, createDocIndex, readerSearchTerms, type SearchDoc, searchDocs } from '../src/index';

// Deterministic 300-page EN+AR deployment. No services, network or query cache.
// `--diverse` (#831) swaps the repeated text for a large, varied vocabulary: every
// page draws its words from 20,000 generated words a language, and the queries are
// one-letter typos of those words, up to multiword queries near the 200-character
// cap, so typo validation scans real vocabularies rather than one repeated text.
const topics = [
  ['Cancel reservation', 'إلغاء الحجز'],
  ['Invoice', 'الفاتورة'],
  ['Add new hotel', 'إضافة فندق جديد'],
  ['Agent commission', 'عمولة الوكيل'],
  ['WhatsApp', 'واتساب'],
  ['Reports', 'التقارير'],
  ['Publish your changes', 'نشر التغييرات'],
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
  'publish',
  'publsh',
  'publixh',
  'publiish',
  'publsh changes',
  'appi',
];
const diverse = process.argv.includes('--diverse');
/** A seeded generator, so every run builds the same corpus. */
const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    return state / 2 ** 32;
  };
};
const ALPHABETS = { en: 'abcdefghijklmnopqrstuvwxyz', ar: 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي' } as const;
const vocabulary = (language: 'en' | 'ar'): string[] => {
  const random = seeded(language === 'en' ? 1 : 2);
  const alphabet = ALPHABETS[language];
  const words = new Set<string>();
  while (words.size < 20_000)
    words.add(Array.from({ length: 4 + Math.floor(random() * 8) }, () => alphabet[Math.floor(random() * alphabet.length)]).join(''));
  return [...words];
};
const vocabularies = { en: vocabulary('en'), ar: vocabulary('ar') };
/** `word` with its middle letter replaced: one edit. */
const typo = (word: string, language: 'en' | 'ar') => {
  const middle = Math.floor(word.length / 2);
  const alphabet = ALPHABETS[language];
  const replacement = alphabet[(alphabet.indexOf(word[middle] ?? '') + 1) % alphabet.length];
  return `${word.slice(0, middle)}${replacement}${word.slice(middle + 1)}`;
};
const diverseDocs = (language: 'en' | 'ar'): SearchDoc[] => {
  const random = seeded(language === 'en' ? 3 : 4);
  const words = vocabularies[language];
  const pick = (count: number) => Array.from({ length: count }, () => words[Math.floor(random() * words.length)]).join(' ');
  return Array.from({ length: 150 }, (_, index) => ({
    id: `${language}-${index}`,
    title: pick(3),
    path: `${language}/guide-${index}`,
    description: pick(12),
    headings: pick(8),
    content: Array.from({ length: 20 }, () => `## ${pick(3)}\n\n${pick(40)}`).join('\n\n'),
  }));
};
/** Typo queries over words the pages use: single words, and multiword queries just under 200 characters. */
const diverseQueries = (language: 'en' | 'ar'): string[] => {
  const random = seeded(language === 'en' ? 5 : 6);
  const long = vocabularies[language].filter((word) => word.length >= 6);
  const word = () => long[Math.floor(random() * long.length)] ?? '';
  const single = Array.from({ length: 6 }, () => typo(word(), language));
  const near200 = Array.from({ length: 3 }, () => {
    let query = typo(word(), language);
    for (let next = word(); query.length + next.length + 1 <= 198; next = word()) query += ` ${next}`;
    return query;
  });
  return [...single, ...near200, word()];
};
const docs = (language: 'en' | 'ar'): SearchDoc[] =>
  diverse
    ? diverseDocs(language)
    : Array.from({ length: 150 }, (_, index) => {
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
const measured = diverse ? [...diverseQueries('en'), ...diverseQueries('ar')] : queries;
for (let round = 0; round < 12; round += 1) {
  for (const query of measured) {
    const at = performance.now();
    const hits = await Promise.all(
      indexes.map((index) => searchDocs(index, query, { limit: 12, ...(reader ? { relevance: 'reader' as const } : {}) })),
    );
    if (round > 1) samples.push(performance.now() - at);
    counts[query.length > 40 ? `${query.slice(0, 37)}… (${query.length} chars)` : query] = hits.flat().length;
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
  `${JSON.stringify({ pages: 300, corpus: diverse ? 'diverse (20,000 words a language)' : 'repeated text', maxQueryChars: Math.max(...measured.map((query) => query.length)), bytes: Buffer.byteLength(snapshot), samples: samples.length, parseMs, buildMs, p50Ms: samples[Math.floor(samples.length * 0.5)], p95Ms: samples[Math.floor(samples.length * 0.95)], maxMs: samples.at(-1), counts, guards }, null, 2)}\n`,
);
