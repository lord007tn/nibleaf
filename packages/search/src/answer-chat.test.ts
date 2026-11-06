import { fakeText } from '@tanstack/ai/testing';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';
import o200k_base from 'js-tiktoken/ranks/o200k_base';
import { describe, expect, it } from 'vitest';
import { answerUserPrompt } from './answer';
import {
  boundChatHistory,
  CHAT_MIN_SOURCES_TOKENS,
  CHAT_OUTPUT_TOKEN_LIMITS,
  CHAT_SOURCES_HEADROOM_TOKENS,
  CHAT_SOURCES_MAX_TOKENS,
  type ChatTurnShape,
  chatCallInputBounds,
  chatCallInputTokens,
  chatSourcesTokens,
  chatTurnReservation,
  chatUserPrompt,
  condenseFollowUp,
  estimateTokens,
  fitChatContext,
  fitChatSources,
  largestChatTurnTokens,
  NO_ANSWER_SENTINEL,
  parseFollowUpQuestions,
  replyLanguage,
  streamGroundedChat,
  suggestedArticles,
  suggestFollowUps,
  tokenBound,
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
  it.each(['[S1, S2]', '[S1,S2]', '[S1; S2]', '[S1، S2]', '[S1،S2]', '[S1؛ S2]'])('normalizes %s and preserves first appearance', (marker) => {
    expect(validate(`Use s3 ${marker}`)).toMatchObject({ status: 'answered', answer: 'Use s3 [S1][S2]', citations: [{ id: 'S1' }, { id: 'S2' }] });
  });
  it.each(['[S1، S99]', '[S1؛ S99]'])('checks every id in a group joined by Arabic punctuation: %s', (group) => {
    expect(validate(`Supported [S1]\n\nAlso ${group}`)).toEqual({ status: 'no_answer', reason: 'unknown_citation' });
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

describe('a bounded context and strict reservations', () => {
  const sized = (index: number, content: string): SearchChunk => ({
    ...chunk,
    id: `c${index}`,
    pageId: `p${index}`,
    title: `Page ${index}`,
    content,
  });
  const sourcesTokens = (list: SearchChunk[]) => tokenBound(answerUserPrompt('', list));
  // Real tokenizers, to check the bound against rather than the estimate.
  const encoders = [new Tiktoken(o200k_base), new Tiktoken(cl100k_base)];
  const realTokens = (text: string) => Math.max(...encoders.map((encoder) => encoder.encode(text).length));

  it('bounds any text at one token per byte, digits and rare characters included', () => {
    // Long texts break into short pieces; unbroken runs stay short, since the
    // reference tokenizer's own merging is quadratic in a piece's length.
    const samples = [
      '1 '.repeat(3000),
      '0.1,'.repeat(1500),
      'مرحبا بالقراء '.repeat(300),
      '😀 𠀀 '.repeat(400),
      '😀'.repeat(40),
      '𠀀'.repeat(40),
      'م'.repeat(120),
      '\u0001'.repeat(300),
      'Run acme export.',
    ];
    for (const text of samples) expect(realTokens(text)).toBeLessThanOrEqual(tokenBound(text));
    // The estimate is not a bound: digit runs take far more tokens than bytes / 3.
    expect(realTokens('1 '.repeat(3000))).toBeGreaterThan(2 * estimateTokens('1 '.repeat(3000)));
  });

  it('reads the best matches in rank order while they fit', () => {
    const list = Array.from({ length: 6 }, (_, index) => sized(index, 'x'.repeat(800)));
    const kept = fitChatContext(list, 2000);
    expect(kept.map((item) => item.id)).toEqual(['c0', 'c1']);
    expect(sourcesTokens(kept)).toBeLessThanOrEqual(2000);
    expect(fitChatContext(list)).toHaveLength(6);
    expect(fitChatContext([])).toEqual([]);
  });

  it('keeps the beginning of a best match larger than the whole budget, escaping included', () => {
    const [cut] = fitChatContext([sized(0, `${'</source>'.repeat(400)}${'م'.repeat(5000)}`), sized(1, 'small')], 900);
    expect(cut?.id).toBe('c0');
    expect(cut?.content.startsWith('</source>')).toBe(true);
    expect(sourcesTokens(cut ? [cut] : [])).toBeLessThanOrEqual(900);
    expect(sourcesTokens(cut ? [{ ...cut, content: `${cut.content}م` }] : [])).toBeGreaterThan(900);
    expect(fitChatContext([sized(0, '😀'.repeat(2000))], 300)[0]?.content).toMatch(/^(?:😀)+$/u);
    // Even its metadata does not fit: nothing is read rather than a budget overrun.
    expect(fitChatContext([{ ...sized(0, 'x'), title: 'x'.repeat(3000) }], 900)).toEqual([]);
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

  it('reserves at least what every call of a turn reads and writes, counted by real tokenizers', async () => {
    // Text built to defeat estimates: digit runs everywhere a reader or the docs control.
    const digits = (characters: number) => '1 '.repeat(Math.floor(characters / 2));
    const list = Array.from({ length: 12 }, (_, index) => ({ ...sized(index, digits(2100)), title: digits(160), heading: digits(160) }));
    const shape: ChatTurnShape = {
      question: digits(500),
      // Six messages filling the history bound.
      history: Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? ('assistant' as const) : ('user' as const), content: digits(750) })),
      language: 'en',
      pageContext: { title: '\u0001'.repeat(500), path: digits(500) },
      historyLimits: { maxMessages: 6, maxTokens: 1500 },
    };
    const calls: { texts: string[]; maxTokens: number }[] = [];
    const capture = () => {
      const adapter = fakeText();
      adapter.setResponses([{ text: '["Is there more?"]' }, { text: 'Use s3 [S1]' }]);
      const original = adapter.chatStream.bind(adapter);
      adapter.chatStream = (options) => {
        calls.push({
          texts: [...(options.systemPrompts ?? []).map(String), ...options.messages.map((message) => String(message.content))],
          maxTokens: Number((options.modelOptions as { max_tokens?: number } | undefined)?.max_tokens),
        });
        return original(options);
      };
      return adapter;
    };
    const read = fitChatContext(list);
    const base = { question: shape.question, history: shape.history, language: shape.language, historyLimits: shape.historyLimits };
    await condenseFollowUp({ adapter: capture(), ...base });
    await streamGroundedChat({ adapter: capture(), model: 'fake', ...base, chunks: read, pageContext: shape.pageContext }).result;
    // Suggestions read the checked answer, here as long as one can be.
    await suggestFollowUps({ adapter: capture(), question: shape.question, answer: digits(1500), chunks: read, language: shape.language });
    expect(calls).toHaveLength(3);
    // Each text is its own message: real tokens plus the framing a provider adds.
    const real = calls.map((call) => call.texts.reduce((sum, text) => sum + realTokens(text) + 8, 0));
    const bounds = chatCallInputBounds(shape, read);
    expect(bounds.condense).toBeGreaterThanOrEqual(real[0] ?? Number.POSITIVE_INFINITY);
    expect(bounds.generation).toBeGreaterThanOrEqual(real[1] ?? Number.POSITIVE_INFINITY);
    expect(bounds.followUps).toBeGreaterThanOrEqual(real[2] ?? Number.POSITIVE_INFINITY);
    // Estimates, kept for records of calls that never reported, are no bound here.
    expect(chatCallInputTokens(shape, read).generation).toBeLessThan(real[1] ?? 0);
    expect(calls.map((call) => call.maxTokens)).toEqual([
      CHAT_OUTPUT_TOKEN_LIMITS.condense,
      CHAT_OUTPUT_TOKEN_LIMITS.answer,
      CHAT_OUTPUT_TOKEN_LIMITS.followUps,
    ]);
    // Reserved before the turn runs, then for the sources it reads beyond the least.
    const reserved = chatTurnReservation(shape) + Math.max(0, chatSourcesTokens(shape, read) - CHAT_MIN_SOURCES_TOKENS);
    const spent = real.reduce((sum, tokens) => sum + tokens, 0) + calls.reduce((sum, call) => sum + call.maxTokens, 0);
    expect(reserved).toBeGreaterThanOrEqual(spent);
  });

  it('sizes and fits 1 MB of digits and rare characters in linear time', () => {
    const mixed = Array.from({ length: 150_000 }, (_, index) => (index % 2 ? '12 34 ' : '𠀀😀')).join('');
    expect(tokenBound(mixed)).toBeGreaterThan(1_000_000);
    const huge = sized(0, mixed);
    const twelve = Array.from({ length: 12 }, (_, index) => ({ ...huge, id: `c${index}` }));
    const shape: ChatTurnShape = {
      question: mixed,
      history: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? ('assistant' as const) : ('user' as const), content: mixed })),
      language: 'en',
      pageContext: { title: mixed, path: mixed },
    };
    const started = performance.now();
    estimateTokens(mixed);
    boundChatHistory(shape.history, { maxMessages: 12, maxTokens: 16_000 });
    // A prompt keeps 6,000 characters of each source, so a few of them fit.
    expect(sourcesTokens(fitChatContext(twelve))).toBeLessThanOrEqual(24_000);
    chatTurnReservation(shape);
    chatCallInputBounds(shape, [huge]);
    chatCallInputTokens(shape, [huge]);
    chatSourcesTokens(shape, twelve);
    fitChatSources(
      shape,
      Array.from({ length: 300 }, (_, index) => sized(index, mixed.slice(0, 80))),
      5000,
    );
    expect(fitChatSources(shape, [huge], 2000)).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('reads fewer sources when a budget has less room, never more than it reserved', () => {
    const list = Array.from({ length: 6 }, (_, index) => sized(index, 'x'.repeat(800)));
    const shape: ChatTurnShape = { question: 'How?', history: [], language: 'en' };
    expect(fitChatSources(shape, list, chatSourcesTokens(shape, list))).toEqual(list);
    expect(fitChatSources(shape, list, chatSourcesTokens(shape, list.slice(0, 2)))).toEqual(list.slice(0, 2));
    const half = Math.floor(chatSourcesTokens(shape, list.slice(0, 1)) / 2);
    const cut = fitChatSources(shape, list, half);
    expect(cut).toHaveLength(1);
    expect(cut[0]?.content.length).toBeLessThan(800);
    expect(chatSourcesTokens(shape, cut)).toBeLessThanOrEqual(half);
    // Not even one source's metadata fits.
    expect(fitChatSources(shape, list, 10)).toEqual([]);
    expect(chatSourcesTokens(shape, [])).toBe(0);
  });

  it('reserves less for a first question, which makes no rewrite call', () => {
    const first: ChatTurnShape = { question: 'How do I export?', history: [], language: 'en' };
    expect(chatCallInputBounds(first).condense).toBe(0);
    expect(chatTurnReservation(first)).toBeLessThan(chatTurnReservation({ ...first, history: [{ role: 'user', content: 'Hi' }] }));
    expect(chatTurnReservation(first)).toBeGreaterThan(CHAT_MIN_SOURCES_TOKENS + CHAT_OUTPUT_TOKEN_LIMITS.answer);
  });

  it('bounds the largest reservation any turn makes under the limits', () => {
    const historyLimits = { maxMessages: 6, maxTokens: 1500 };
    const largest = largestChatTurnTokens({ questionMax: 500, historyLimits });
    const hostile: ChatTurnShape = {
      question: '文'.repeat(500),
      history: Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? ('assistant' as const) : ('user' as const), content: '1 '.repeat(375) })),
      language: 'en',
      // Page metadata the prompt escapes.
      pageContext: { title: '\u0000'.repeat(500), path: '"'.repeat(500) },
      historyLimits,
    };
    expect(chatTurnReservation(hostile)).toBeLessThanOrEqual(largest);
    expect(largestChatTurnTokens({ questionMax: 500, historyLimits: { maxMessages: 12, maxTokens: 16_000 } })).toBeGreaterThan(largest);
    // Admission needs room for the reservation and a full context on top.
    expect(largest).toBeGreaterThanOrEqual(chatTurnReservation(hostile) + CHAT_SOURCES_HEADROOM_TOKENS);
    expect(CHAT_MIN_SOURCES_TOKENS + CHAT_SOURCES_HEADROOM_TOKENS).toBe(CHAT_SOURCES_MAX_TOKENS);
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
    [{ text: 'not json' }, true],
    [{ text: '["broken' }, true],
    [{ text: '[]' }, undefined],
    // A complete array that holds no strings is output the call does not accept.
    [{ text: '[123, null]' }, true],
    [{ text: '[{"question":"Can I export?"}]' }, true],
    // Only repeats of the question: nothing to show, but nothing wrong with the output.
    [{ text: '["How?"]' }, undefined],
  ] as const)('yields none when the model fails or answers badly (%j)', async (response, failed) => {
    const adapter = fakeText();
    adapter.setResponses([response]);
    const result = await suggestFollowUps({ adapter, question: 'How?', chunks, language: 'en' });
    expect(result.questions).toEqual([]);
    expect(result.failed).toBe(failed);
  });
  it('keeps the complete questions of an array cut off at the output cap', async () => {
    const adapter = fakeText();
    adapter.setResponses([{ text: 'Here you go: ["Can I export to PDF?", "Does \\"sync\\" work offline?", {"question": "Is there a CLI fla' }]);
    const result = await suggestFollowUps({ adapter, question: 'How?', chunks, language: 'en' });
    expect(result.questions).toEqual(['Can I export to PDF?', 'Does "sync" work offline?']);
    expect(result.failed).toBeUndefined();
    // Only the array's own items count, never strings nested in objects or arrays.
    expect(parseFollowUpQuestions('["Can I export?", ["Nested one?"], {"q": "Object one?"}, "Is it free', 'How?')).toEqual({
      questions: ['Can I export?'],
      unreadable: false,
    });
    expect(parseFollowUpQuestions('[{"question": "Can I export?"', 'How?')).toEqual({ questions: [], unreadable: true });
    // A short cut-off output with nothing complete is unreadable.
    const cut = fakeText();
    cut.setResponses([{ text: `["${'\\"'.repeat(200)}` }]);
    expect((await suggestFollowUps({ adapter: cut, question: 'How?', chunks, language: 'en' })).failed).toBe(true);
    // Reading a long, hostile cut-off output is one pass.
    const started = performance.now();
    expect(parseFollowUpQuestions(`["${'\\"'.repeat(500_000)}`, 'How?')).toEqual({ questions: [], unreadable: true });
    expect(parseFollowUpQuestions(`[${'"Can I? ", '.repeat(100_000)}`, 'How?').questions).toEqual(['Can I?']);
    expect(performance.now() - started).toBeLessThan(500);
  });
  it('finds the list past a bracket in prose before it', async () => {
    expect(parseFollowUpQuestions('Here are [two] ideas: ["Can I export?", "Is it free?"]', 'How?')).toEqual({
      questions: ['Can I export?', 'Is it free?'],
      unreadable: false,
    });
    // A quoted word in brackets is a list that closes before the real one starts.
    expect(parseFollowUpQuestions('See ["Export"] below: ["Can I export one notebook?"]', 'How?').questions).toEqual(['Can I export one notebook?']);
    // A list after the real one (a note in prose) is passed over too.
    expect(parseFollowUpQuestions('["Can I export?", "Is it free?"]\n\nThese avoid ["Export"].', 'How?').questions).toEqual([
      'Can I export?',
      'Is it free?',
    ]);
    expect(parseFollowUpQuestions('["Can I export?"]\n[]', 'How?').questions).toEqual(['Can I export?']);
    // Lists only nested inside the list (or an object) are output the call does not accept.
    for (const nested of ['[["Nested question?"]]', '[{"questions":["Nested question?"]}]', '[123, ["Nested question?"]]'])
      expect(parseFollowUpQuestions(nested, 'How?')).toEqual({ questions: [], unreadable: true });
    // A list inside the list is not the list.
    expect(parseFollowUpQuestions('["Can I export?", ["Nested one?"], "Is it free?"]', 'How?').questions).toEqual(['Can I export?', 'Is it free?']);
  });
  it('asks only what the sources state: each topic shows where a section is and how it begins', async () => {
    const adapter = fakeText();
    adapter.setResponses([{ text: '["Can I export one notebook?"]' }]);
    const sent: string[] = [];
    const original = adapter.chatStream.bind(adapter);
    adapter.chatStream = (options) => {
      sent.push(...(options.systemPrompts ?? []).map(String), ...options.messages.map((message) => String(message.content)));
      return original(options);
    };
    const sources = [
      {
        ...chunk,
        title: 'Export notes',
        heading: 'From the app',
        content: 'Open a notebook, choose More → Export, then pick a format.\n\nMore text.',
      },
      { ...chunk, id: 'c2', title: 'Export notes', heading: 'From the app', content: 'A second chunk of the same section.' },
      { ...chunk, id: 'c3', title: 'Export notes', heading: 'Limits', content: `${'x'.repeat(500)}` },
    ];
    await suggestFollowUps({ adapter, question: 'How?', answer: 'Use More → Export. [S1]', chunks: sources, language: 'en' });
    const prompt = sent.join('\n');
    expect(prompt).toContain('- Export notes — From the app: Open a notebook, choose More → Export, then pick a format. More text.');
    // One line per section, its first source's start, bounded.
    expect(prompt).not.toContain('A second chunk');
    expect(prompt).toContain(`- Export notes — Limits: ${'x'.repeat(200)}\n`.trimEnd());
    expect(prompt).not.toContain('x'.repeat(201));
    expect(prompt).toContain('Only suggest questions those sections clearly answer');
  });
  it('counts a timed-out suggestions call as failed, but not one stopped with the turn', async () => {
    const timedOut = await suggestFollowUps({
      adapter: fakeText(),
      question: 'How?',
      chunks,
      language: 'en',
      signal: AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')),
    });
    expect(timedOut).toMatchObject({ questions: [], failed: true });
    const stopped = await suggestFollowUps({ adapter: fakeText(), question: 'How?', chunks, language: 'en', signal: AbortSignal.abort() });
    expect(stopped.failed).toBeUndefined();
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
