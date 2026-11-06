import { fakeText } from '@tanstack/ai/testing';
import { describe, expect, it } from 'vitest';
import { answerUserPrompt } from './answer';
import {
  boundChatHistory,
  CHAT_CONTEXT_TOKENS,
  CHAT_OUTPUT_TOKEN_LIMITS,
  type ChatTurnShape,
  chatCallInputTokens,
  chatUserPrompt,
  condenseFollowUp,
  estimateChatTurnTokens,
  estimateTokens,
  fitChatContext,
  largestChatTurnTokens,
  NO_ANSWER_SENTINEL,
  replyLanguage,
  streamGroundedChat,
  suggestedArticles,
  suggestFollowUps,
} from './answer-chat';
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
const chunks = [chunk, { ...chunk, id: 'c2', pageId: 'p2' }];
const validate = (answer: string) => validateCitedAnswer(answer, chunks, 'storage', 'chat');
const run = (text: string, language = 'en') => {
  const adapter = fakeText();
  adapter.setResponses([{ text }]);
  return streamGroundedChat({ adapter, model: 'fake', question: 'How?', history: [], chunks, language });
};
const collect = async (deltas: AsyncIterable<string>) => {
  const parts: string[] = [];
  for await (const delta of deltas) parts.push(delta);
  return parts;
};

describe('chat citation policy', () => {
  it.each(['[S1, S2]', '[S1,S2]', '[S1; S2]', '[S1، S2]', '[S1،S2]'])('normalizes %s and preserves first appearance', (marker) => {
    expect(validate(`Use s3 ${marker}`)).toMatchObject({ status: 'answered', answer: 'Use s3 [S1][S2]', citations: [{ id: 'S1' }, { id: 'S2' }] });
  });
  it('checks every id in a group joined by Arabic commas', () => {
    expect(validate('Supported [S1]\n\nAlso [S1، S99]')).toEqual({ status: 'no_answer', reason: 'unknown_citation' });
  });
  it('handles Arabic and deduplicates citations', () =>
    expect(validate('استخدم التخزين [S2][S1][S2]')).toMatchObject({ status: 'answered', citations: [{ id: 'S2' }, { id: 'S1' }] }));
  it.each(['[S99]', '[S0]', '[S01]'])('rejects unknown ids anywhere: %s', (id) =>
    expect(validate(`Supported [S1]\n\n~~~\n${id}\n~~~`)).toEqual({ status: 'no_answer', reason: 'unknown_citation' }),
  );
  it('keeps fences, headings, cited lists and lead-ins', () => {
    const text =
      '# Setup\n\nSupported [S1]\n\nRun this:\n\n```sh\npnpm dev\n\necho ok\n```\n\nOptions:\n\n- Use s3 [S1]\n- Configure storage\n\n## Dangling';
    expect(validate(text)).toMatchObject({ status: 'answered', answer: text.replace('\n\n## Dangling', ''), droppedParagraphs: 0 });
  });
  it('drops one later unsupported block out of three', () =>
    expect(validate('First [S1]\n\nUnsupported\n\nLast [S2]')).toMatchObject({
      status: 'answered',
      answer: 'First [S1]\n\nLast [S2]',
      droppedParagraphs: 1,
    }));
  it.each(['Unsupported\n\nLast [S1]', 'First [S1]\n\nUnsupported', 'No markers'])('rejects unsupported claims: %s', (text) =>
    expect(validate(text)).toEqual({ status: 'no_answer', reason: 'uncited' }),
  );
  it('lets the sentence right after a list of steps cite that list (live model output)', () => {
    const text =
      '## From the app\n\n1. Open a notebook.\n2. Select **More → Export**.\n3. Select **Download**.\n\nOne export can include up to 500 notes. [S1][S2]\n\n## From the CLI\n\n```bash\nacme export --format markdown\n```\n\nTo export one notebook, add `--notebook <name>`. [S2]';
    expect(validate(text)).toMatchObject({ status: 'answered', answer: text, droppedParagraphs: 0 });
  });
  it('does not let a list borrow a citation across a heading', () =>
    expect(validate('- Uncited step\n\n## Next\n\nCited [S1]')).toEqual({ status: 'no_answer', reason: 'uncited' }));
  it('does not exempt ordinary colon prose without a supported successor', () =>
    expect(validate('First [S1]\n\nUnproven:\n\nUnsupported')).toMatchObject({ status: 'no_answer' }));
  it('strict policy retains headings and code paragraph requirements', () =>
    expect(validateCitedAnswer('# Setup\n\nYes [S1]', chunks, '', 'strict')).toMatchObject({ status: 'no_answer' }));
  it('returns empty for whitespace', () => expect(validate('  ')).toEqual({ status: 'no_answer', reason: 'empty' }));
});
describe('streaming grounded chat with real TanStack fake adapter', () => {
  it('aborts after streaming begins and the adapter receives cancellation', async () => {
    const adapter = fakeText({ tokensPerSecond: 1000 });
    let providerSignal: AbortSignal | undefined;
    adapter.setResponses([
      ({ request }) => {
        providerSignal = request.request?.signal ?? request.abortController?.signal;
        return { text: 'A supported documentation response [S1] '.repeat(30) };
      },
    ]);
    const controller = new AbortController();
    const { result, deltas } = streamGroundedChat({
      adapter,
      model: 'fake',
      question: 'How?',
      history: [],
      chunks,
      language: 'en',
      signal: controller.signal,
    });
    for await (const delta of deltas) {
      expect(delta.length).toBeGreaterThan(0);
      controller.abort();
      break;
    }
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(providerSignal?.aborted).toBe(true);
  });
  it('streams ordered deltas, captures usage and timing', async () => {
    const text = 'Use the documented storage configuration [S1]';
    const { deltas, result } = run(text);
    const parts = await collect(deltas);
    expect(parts.join('')).toBe(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(await result).toMatchObject({
      status: 'answered',
      usage: { totalTokens: expect.any(Number) },
      firstTokenMs: expect.any(Number),
      latencyMs: expect.any(Number),
    });
  });
  it('suppresses a split sentinel including leading whitespace', async () => {
    const { deltas, result } = run(`  ${NO_ANSWER_SENTINEL}`, 'ar');
    expect(await collect(deltas)).toEqual([]);
    expect(await result).toMatchObject({ status: 'no_answer', noAnswerReason: 'model_declined' });
  });
  it.each([
    ['Claim [S99]', 'no_answer', 0],
    ['A [S1]\n\nUnsupported\n\nB [S2]', 'answered', 1],
    ['A [S1]\n\nUnsupported', 'no_answer', 0],
    ['استخدم التخزين [S1, S2]', 'answered', 0],
  ] as const)('validates %s', async (text, status, droppedParagraphs) => {
    const { deltas, result } = run(text);
    await collect(deltas);
    expect(await result).toMatchObject({ status, droppedParagraphs });
  });
  it('returns unverified for unknown citations', async () => {
    const { result } = run('Claim [S99]');
    expect(await result).toMatchObject({ noAnswerReason: 'unverified', validationFailure: 'unknown_citation' });
  });
  it('settles without a delta consumer', async () => expect(await run('Yes [S1]').result).toMatchObject({ status: 'answered' }));
  it('sanitizes provider errors and ends deltas', async () => {
    const adapter = fakeText();
    adapter.setResponses([{ error: 'SECRET credential provider text' }]);
    const { result, deltas } = streamGroundedChat({ adapter, model: 'fake', question: 'How?', history: [], chunks, language: 'en' });
    await collect(deltas);
    await expect(result).rejects.toThrow('The chat provider could not complete the request.');
  });
  it('aborts an active provider call', async () => {
    const adapter = fakeText({ tokensPerSecond: 100 });
    adapter.setResponses([{ text: 'A long supported response [S1]'.repeat(20) }]);
    const controller = new AbortController();
    const { result, deltas } = streamGroundedChat({
      adapter,
      model: 'fake',
      question: 'How?',
      history: [],
      chunks,
      language: 'en',
      signal: controller.signal,
    });
    controller.abort();
    await collect(deltas);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
describe('history and follow-up queries', () => {
  it('bounds UTF8 tokens, strips assistant citations, never starts assistant', () => {
    const bounded = boundChatHistory(
      [
        { role: 'assistant', content: 'old' },
        { role: 'user', content: 'سؤال' },
        { role: 'assistant', content: 'جواب [S1, S2] ثم [S1، S2]' },
      ],
      { maxMessages: 3, maxTokens: 30 },
    );
    expect(bounded[0]?.role).toBe('user');
    expect(bounded[1]?.content).toBe('جواب  ثم');
    expect(estimateTokens('سؤال')).toBe(3);
    const truncated = boundChatHistory([{ role: 'user', content: 'س'.repeat(100) }], { maxMessages: 1, maxTokens: 5 });
    expect(estimateTokens(truncated[0]?.content ?? '')).toBeLessThanOrEqual(5);
    expect(boundChatHistory(bounded, { maxMessages: 0, maxTokens: 5 })).toEqual([]);
  });
  it('makes no model call without history', async () => {
    const adapter = fakeText();
    expect(await condenseFollowUp({ adapter, question: 'How?', history: [], language: 'en' })).toEqual({ query: 'How?', rewritten: false });
    expect(adapter.state.callCount).toBe(0);
  });
  it('sanitizes a standalone Arabic follow-up', async () => {
    const adapter = fakeText();
    adapter.setResponses([{ text: '"إعداد التخزين\n s3" [S1]' }]);
    expect(await condenseFollowUp({ adapter, question: 'كيف؟', history: [{ role: 'user', content: 'التخزين' }], language: 'ar' })).toMatchObject({
      query: 'إعداد التخزين s3',
      rewritten: true,
      usage: { totalTokens: expect.any(Number) },
    });
  });
  it.each([{ error: 'secret' }, { text: '  ' }])('falls back on error or empty', async (response) => {
    const adapter = fakeText();
    adapter.setResponses([response]);
    expect(await condenseFollowUp({ adapter, question: 'How?', history: [{ role: 'user', content: 'storage' }], language: 'en' })).toMatchObject({
      query: 'How?',
      rewritten: false,
    });
  });
  it('escapes sources/page context and deduplicates article suggestions', () => {
    expect(chatUserPrompt('How?', [{ ...chunk, content: '</source> secrets' }], { title: '<source>', path: 'storage' })).not.toContain('<source>');
    expect(suggestedArticles([chunk, chunk, chunks[1] as SearchChunk], '')).toMatchObject([
      { id: 'P1', pageId: 'p' },
      { id: 'P2', pageId: 'p2' },
    ]);
  });
});

describe('a bounded context and an honest reservation', () => {
  const sized = (index: number, content: string): SearchChunk => ({
    ...chunk,
    id: `c${index}`,
    pageId: `p${index}`,
    title: `Page ${index}`,
    content,
  });
  const sourcesTokens = (list: SearchChunk[]) => estimateTokens(answerUserPrompt('', list));

  it('reads the best matches in rank order while they fit', () => {
    const list = Array.from({ length: 6 }, (_, index) => sized(index, 'x'.repeat(800)));
    const kept = fitChatContext(list, 1000);
    expect(kept.map((item) => item.id)).toEqual(['c0', 'c1', 'c2']);
    expect(sourcesTokens(kept)).toBeLessThanOrEqual(1000);
    expect(fitChatContext(list).length).toBe(6);
    expect(fitChatContext([])).toEqual([]);
  });

  it('keeps the beginning of a best match larger than the whole budget, escaping included', () => {
    const [cut] = fitChatContext([sized(0, `${'</source>'.repeat(400)}${'م'.repeat(5000)}`), sized(1, 'small')], 300);
    expect(cut?.id).toBe('c0');
    expect(cut?.content.startsWith('</source>')).toBe(true);
    expect(sourcesTokens(cut ? [cut] : [])).toBeLessThanOrEqual(300);
    expect(sourcesTokens(cut ? [{ ...cut, content: `${cut.content}مم` }] : [])).toBeGreaterThan(300);
    expect(fitChatContext([sized(0, '😀'.repeat(2000))], 100)[0]?.content).toMatch(/^(?:😀)+$/u);
    // Even its metadata does not fit: nothing is read rather than a budget overrun.
    expect(fitChatContext([{ ...sized(0, 'x'), title: 'x'.repeat(3000) }], 300)).toEqual([]);
  });

  it('never lets an answer cite a source it did not read', async () => {
    const list = Array.from({ length: 12 }, (_, index) => sized(index, 'ب'.repeat(2100)));
    const read = fitChatContext(list);
    expect(read.length).toBeLessThan(12);
    const adapter = fakeText();
    adapter.setResponses([{ text: `Use s3 [S1] and [S${read.length + 1}]` }]);
    const sent: string[] = [];
    const original = adapter.chatStream.bind(adapter);
    adapter.chatStream = (options) => {
      sent.push(...options.messages.map((message) => String(message.content)));
      return original(options);
    };
    const { result } = streamGroundedChat({ adapter, model: 'fake', question: 'How?', history: [], chunks: list, language: 'ar' });
    expect(await result).toMatchObject({ status: 'no_answer', validationFailure: 'unknown_citation' });
    expect(sent.join('\n')).toContain(`id="S${read.length}"`);
    expect(sent.join('\n')).not.toContain(`id="S${read.length + 1}"`);
  });

  it('reserves at least what every call of a turn sends and may write', async () => {
    const list = Array.from({ length: 12 }, (_, index) => ({ ...sized(index, 'ش'.repeat(2100)), title: 'ع'.repeat(160), heading: 'ح'.repeat(160) }));
    const shape: ChatTurnShape = {
      question: 'س'.repeat(500),
      // Six messages filling the history bound, and the longest question.
      history: Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? ('assistant' as const) : ('user' as const), content: 'ج'.repeat(375) })),
      language: 'ar',
      pageContext: { title: 'ص'.repeat(500), path: 'p'.repeat(500) },
      historyLimits: { maxMessages: 6, maxTokens: 1500 },
    };
    const calls: { system: string[]; messages: string[]; maxTokens: number }[] = [];
    const capture = () => {
      const adapter = fakeText();
      adapter.setResponses([{ text: '["Is there more?"]' }, { text: 'Use s3 [S1]' }]);
      const original = adapter.chatStream.bind(adapter);
      adapter.chatStream = (options) => {
        calls.push({
          system: (options.systemPrompts ?? []).map(String),
          messages: options.messages.map((message) => String(message.content)),
          maxTokens: Number((options.modelOptions as { max_tokens?: number } | undefined)?.max_tokens),
        });
        return original(options);
      };
      return adapter;
    };
    const base = { question: shape.question, history: shape.history, language: shape.language, historyLimits: shape.historyLimits };
    await condenseFollowUp({ adapter: capture(), ...base });
    await streamGroundedChat({ adapter: capture(), model: 'fake', ...base, chunks: list, pageContext: shape.pageContext }).result;
    await suggestFollowUps({ adapter: capture(), question: shape.question, chunks: fitChatContext(list), language: shape.language });
    expect(calls).toHaveLength(3);
    const sent = calls.map((call) => [...call.system, ...call.messages].reduce((sum, text) => sum + estimateTokens(text), 0));
    const sizes = chatCallInputTokens(shape, list);
    expect(sizes.condense).toBeGreaterThanOrEqual(sent[0] ?? Number.POSITIVE_INFINITY);
    expect(sizes.generation).toBeGreaterThanOrEqual(sent[1] ?? Number.POSITIVE_INFINITY);
    expect(sizes.followUps).toBeGreaterThanOrEqual(sent[2] ?? Number.POSITIVE_INFINITY);
    // Before retrieval, the turn is sized for a full context and the widest topics.
    const ahead = chatCallInputTokens(shape);
    expect(ahead.generation).toBeGreaterThanOrEqual(sizes.generation);
    expect(ahead.followUps).toBeGreaterThanOrEqual(sizes.followUps);
    expect(calls.map((call) => call.maxTokens)).toEqual([
      CHAT_OUTPUT_TOKEN_LIMITS.condense,
      CHAT_OUTPUT_TOKEN_LIMITS.answer,
      CHAT_OUTPUT_TOKEN_LIMITS.followUps,
    ]);
    const spent = sent.reduce((sum, tokens) => sum + tokens, 0) + calls.reduce((sum, call) => sum + call.maxTokens, 0);
    // A margin over the estimate covers a provider's own tokenizer.
    expect(estimateChatTurnTokens(shape)).toBeGreaterThanOrEqual(Math.ceil(spent * 1.2));
    expect(estimateChatTurnTokens(shape)).toBeLessThanOrEqual(
      largestChatTurnTokens({ questionMax: 500, historyLimits: shape.historyLimits ?? { maxMessages: 0, maxTokens: 0 }, language: 'ar' }),
    );
  });

  it('reserves less for a first question, which makes no rewrite call', () => {
    const first = estimateChatTurnTokens({ question: 'How do I export?', history: [], language: 'en' });
    const followUp = estimateChatTurnTokens({ question: 'How do I export?', history: [{ role: 'user', content: 'Hi' }], language: 'en' });
    expect(chatCallInputTokens({ question: 'How do I export?', history: [], language: 'en' }).condense).toBe(0);
    expect(first).toBeLessThan(followUp);
    expect(first).toBeGreaterThan(CHAT_CONTEXT_TOKENS);
  });
});

describe('reply language', () => {
  it.each([
    ['How do I export my notes?', 'en', /^English/],
    ['How do I export my notes?', 'ar', /Latin script, most likely English/],
    ['كيف أصدّر ملاحظاتي؟', 'en', /^Arabic$/],
    ['كيف أعمل export للـ notebook بصيغة Markdown؟', 'ar', /^Arabic \(keep the English names/],
    ['میں نوٹس کیسے برآمد کروں؟', 'ur', /^Urdu$/],
    ['Comment exporter mes notes ?', 'fr', /^French/],
    ['?', 'en', /language of the question/],
  ])('decides %s on a %s site', (question, site, expected) => expect(replyLanguage(question, site)).toMatch(expected));
  it('states it after the sources, where it cannot be missed', () => {
    expect(chatUserPrompt('How?', [chunk], undefined, 'ar')).toMatch(/Reply in: the language of the question \(it is written in Latin script/);
  });
});

describe('follow-up suggestions', () => {
  it('returns up to three sanitized, deduplicated questions from a JSON array', async () => {
    const adapter = fakeText();
    adapter.setResponses([
      { text: 'Sure: ["How do I change storage? [S1]", "how?", "How do I change storage?", "Can I use local disk?", "Is S3 required?", "Extra"]' },
    ]);
    const result = await suggestFollowUps({ adapter, question: 'How?', answer: 'Use s3 [S1]', chunks, language: 'en' });
    expect(result.questions).toEqual(['How do I change storage?', 'Can I use local disk?', 'Is S3 required?']);
  });
  it('never suggests a question the reader already asked in this conversation', async () => {
    const adapter = fakeText();
    adapter.setResponses([{ text: '["Can I export my notes from the app", "هل يمكنني التصدير؟", "Are there limits on exports?"]' }]);
    const result = await suggestFollowUps({
      adapter,
      question: 'And from the CLI?',
      chunks,
      language: 'en',
      asked: ['Can I export my notes from the app?', 'هل يمكنني التصدير'],
    });
    expect(result.questions).toEqual(['Are there limits on exports?']);
  });
  it('compares suggestions with earlier questions in linear time', async () => {
    const adapter = fakeText();
    adapter.setResponses([{ text: '["Can I export?"]' }]);
    const started = performance.now();
    const result = await suggestFollowUps({
      adapter,
      question: `${'?'.repeat(50_000)}x`,
      chunks,
      language: 'en',
      asked: [`${'. '.repeat(25_000)}x`],
    });
    expect(result.questions).toEqual(['Can I export?']);
    expect(performance.now() - started).toBeLessThan(200);
  });
  it.each([
    [{ error: 'boom' }, true],
    [{ text: 'not json' }, undefined],
    [{ text: '["broken' }, undefined],
  ] as const)('yields none when the model fails or answers badly (%j)', async (response, failed) => {
    const adapter = fakeText();
    adapter.setResponses([response]);
    const result = await suggestFollowUps({ adapter, question: 'How?', chunks, language: 'en' });
    expect(result.questions).toEqual([]);
    expect(result.failed).toBe(failed);
  });
  it('reports a failed rewrite so the server can count it', async () => {
    const adapter = fakeText();
    adapter.setResponses([{ error: 'boom' }]);
    expect(await condenseFollowUp({ adapter, question: 'How?', history: [{ role: 'user', content: 'storage' }], language: 'en' })).toMatchObject({
      query: 'How?',
      failed: true,
    });
  });
  it('makes no call without sources', async () => {
    const adapter = fakeText();
    expect(await suggestFollowUps({ adapter, question: 'How?', answer: '', chunks: [], language: 'en' })).toEqual({ questions: [] });
    expect(adapter.state.callCount).toBe(0);
  });
});
