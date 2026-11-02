import { describe, test } from 'vitest';
import { createDocIndex, normalizeArabicMorphologyText, type SearchDoc, searchDocs } from './index';

const sample = 'والمستخدمين إعداداتهم API-v2 `المكتبات` واجهات المطورين. '.repeat(1000);
const docs: SearchDoc[] = Array.from({ length: 500 }, (_, index) => ({
  id: String(index),
  title: `إعدادات المستخدمين ${index}`,
  path: `page-${index}`,
  description: 'دليل الصلاحيات',
  headings: 'واجهات المطورين',
  content: 'شرح للمستخدمين عن الحسابات والإشعارات والمكتبات.',
}));
describe('Arabic morphology throughput', () => {
  test('analyze 1,000 mixed documentation tokens', async ({ bench }) => {
    await bench('normalize mixed documentation', () => {
      normalizeArabicMorphologyText(sample);
    }).run({ time: 500, warmupTime: 100 });
  });

  test('query a 500-document Arabic index', async ({ bench }) => {
    const index = await createDocIndex(docs, 'arabic');
    await bench('search Arabic documents', async () => {
      await searchDocs(index, 'مستخدم', { tolerance: 1 });
    }).run({ time: 500, warmupTime: 100 });
  });
});
