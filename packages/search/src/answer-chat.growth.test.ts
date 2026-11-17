import { growthMs, growthMsAsync, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { fakeText } from '@tanstack/ai/testing';
import { describe, expect, it } from 'vitest';
import {
  boundChatHistory,
  type ChatTurnShape,
  chatCallInputBounds,
  chatCallInputTokens,
  chatSourcesTokens,
  chatTurnReservation,
  estimateTokens,
  fitChatContext,
  fitChatSources,
  parseFollowUpQuestions,
  suggestFollowUps,
} from './answer-chat';
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
const chunks = [chunk, { ...chunk, id: 'c2', pageId: 'p2' }];
const sized = (index: number, content: string): SearchChunk => ({ ...chunk, id: `c${index}`, pageId: `p${index}`, title: `Page ${index}`, content });

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
// The functional assertions for the same inputs stay in answer-chat.test.ts.
describe.runIf(growthTestsEnabled)('chat context and follow-ups: growth', () => {
  it('sizes and fits digits and rare characters in linear time', () => {
    const mixedOf = (segments: number) => Array.from({ length: segments }, (_, index) => (index % 2 ? '12 34 ' : '𠀀😀')).join('');
    /** Everything a chat turn sizes and fits, for one input. */
    const sizeAndFit = (mixed: string) => {
      const huge = sized(0, mixed);
      const twelve = Array.from({ length: 12 }, (_, index) => ({ ...huge, id: `c${index}` }));
      const shape: ChatTurnShape = {
        question: mixed,
        history: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? ('assistant' as const) : ('user' as const), content: mixed })),
        language: 'en',
        pageContext: { title: mixed, path: mixed },
      };
      estimateTokens(mixed);
      boundChatHistory(shape.history, { maxMessages: 12, maxTokens: 16_000 });
      fitChatContext(twelve);
      chatTurnReservation(shape);
      chatCallInputBounds(shape, [huge]);
      chatCallInputTokens(shape, [huge]);
      chatSourcesTokens(shape, twelve);
      fitChatSources(
        shape,
        Array.from({ length: 300 }, (_, index) => sized(index, mixed.slice(0, 80))),
        5000,
      );
      return fitChatSources(shape, [huge], 2000);
    };
    // 4x the input costs about 4x; a quadratic regression would show as 16x.
    const [small, large] = growthMs(sizeAndFit, mixedOf(37_500), mixedOf(150_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('compares suggestions with earlier questions in linear time', async () => {
    const adapter = fakeText();
    const suggest = (n: number) => {
      adapter.setResponses([{ text: '["Can I export?"]' }]);
      return suggestFollowUps({ adapter, question: `${'?'.repeat(n)}x`, chunks, language: 'en', asked: [`${'. '.repeat(n / 2)}x`] });
    };
    // 4x the question and history costs about 4x.
    const [small, large] = await growthMsAsync(suggest, 12_500, 50_000);
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('reads a long, hostile cut-off output in one pass', () => {
    const escapes = (n: number) => `["${'\\"'.repeat(n)}`;
    const repeats = (n: number) => `[${'"Can I? ", '.repeat(n)}`;
    const parse = (output: string) => parseFollowUpQuestions(output, 'How?');
    const pairs: Array<[string, string]> = [
      [escapes(125_000), escapes(500_000)],
      [repeats(25_000), repeats(100_000)],
    ];
    for (const [smallInput, largeInput] of pairs) {
      const [small, large] = growthMs(parse, smallInput, largeInput);
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    }
  });
});
