import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { validateCitedAnswer } from './answer-validation';
import type { SearchChunk } from './hybrid';

const chunk: SearchChunk = {
  id: 'c',
  pageId: 'p',
  ordinal: 0,
  title: 'Storage',
  path: 'storage',
  description: '',
  heading: 'Config',
  headingPath: [],
  content: 'Use s3',
  contentHash: 'h',
  language: 'en',
  direction: 'ltr',
  visible: true,
};

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('chat heading detection: growth', () => {
  it.each([
    [
      'refusal with 100k spaces',
      (n: number) => `I couldn't verify this from the docs.${' '.repeat(n * 1000)}Try another question. [S1]`,
      'no_answer',
    ],
    [
      '100k spaces interleaved with partial refusal tokens',
      (n: number) => `I could${`n't v${' '.repeat(1000)}`.repeat(n)}erify this. [S1]`,
      'answered',
    ],
  ] as const)('handles %s in linear time', (_name, build, _status) => {
    // 4x the whitespace costs about 4x (testing/growth).
    const [small, large] = growthMs((answer: string) => validateCitedAnswer(answer, [chunk], '', 'chat'), build(25), build(100));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
  it('stays linear on a hash followed by a long run of spaces', () => {
    const answer = (n: number) => `Use s3 [S1]\n\n#${' '.repeat(n)}x\n\nMore s3 [S1]`;
    const validate = (text: string) => validateCitedAnswer(text, [chunk], 'storage', 'chat');
    const [small, large] = growthMs(validate, answer(12_500), answer(50_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
