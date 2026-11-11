import { growthMs, growthMsAsync, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { createDocIndex, normalizeArabicMorphologyText, type SearchDoc, searchDocs } from './index';

const doc = (id: string, title: string, content = ''): SearchDoc => ({
  id,
  title,
  path: id,
  description: '',
  headings: '',
  content,
});

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('Arabic morphology performance guards', () => {
  // Each bound times the same work at 4x the size (testing/growth): linear work
  // grows about 4x, quadratic 16x, whatever the runner's speed.
  it('analyzes a large documentation sample in linear time', () => {
    const sample = (n: number) => 'والمستخدمين إعداداتهم API-v2 `المكتبات` واجهات المطورين. '.repeat(n);
    const [small, large] = growthMs(normalizeArabicMorphologyText, sample(1000), sample(4000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('handles many malformed unmatched code delimiters in linear time', () => {
    const sample = (n: number) => Array.from({ length: n }, () => '` مستخدم دون اغلاق').join('\n');
    const [small, large] = growthMs(normalizeArabicMorphologyText, sample(1000), sample(4000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('indexes and answers repeated morphology queries in linear time', async () => {
    const docs = (n: number) =>
      Array.from({ length: n }, (_, index) =>
        doc(`doc-${index}`, `إعدادات المستخدمين ${index}`, 'دليل للمطورين يشرح الصلاحيات والواجهات والحسابات.'),
      );
    const indexAndSearch = async (input: SearchDoc[]) => {
      const index = await createDocIndex(input, 'arabic');
      for (let iteration = 0; iteration < 20; iteration += 1) await searchDocs(index, 'مستخدم', { tolerance: 1 });
      return index;
    };
    const [small, large] = await growthMsAsync(indexAndSearch, docs(75), docs(300));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
