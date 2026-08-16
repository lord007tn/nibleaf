import { bench, describe } from 'vitest';
import { createDocIndex, normalizeArabicMorphologyText, type SearchDoc, searchDocs } from './index';

const sample = 'والمستخدمين إعداداتهم API-v2 `المكتبات` واجهات المطورين. '.repeat(1_000);
const docs: SearchDoc[] = Array.from({ length: 500 }, (_, index) => ({
  id: String(index),
  title: `إعدادات المستخدمين ${index}`,
  path: `page-${index}`,
  description: 'دليل الصلاحيات',
  headings: 'واجهات المطورين',
  content: 'شرح للمستخدمين عن الحسابات والإشعارات والمكتبات.',
}));
const indexPromise = createDocIndex(docs, 'arabic');

describe('Arabic morphology throughput', () => {
  bench(
    'analyze 1,000 mixed documentation tokens',
    () => {
      normalizeArabicMorphologyText(sample);
    },
    { time: 500, warmupTime: 100 },
  );

  bench(
    'query a 500-document Arabic index',
    async () => {
      const index = await indexPromise;
      await searchDocs(index, 'مستخدم', { tolerance: 1 });
    },
    { time: 500, warmupTime: 100 },
  );
});
