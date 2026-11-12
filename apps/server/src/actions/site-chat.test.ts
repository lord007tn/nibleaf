import { AI_CHAT_EVENT, aiChatFinalEventSchema, aiChatFollowUpsEventSchema, type SiteChatBody } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  runtime: vi.fn(),
  retrieve: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  settle: vi.fn(),
  quota: vi.fn(),
  served: vi.fn(async () => undefined),
  recordTurn: vi.fn(),
  recordFeedback: vi.fn(),
  // Whether this instance can archive question text (see readerChatPolicy below).
  storageReady: true,
  track: vi.fn(),
  condense: vi.fn(),
  stream: vi.fn(),
  suggest: vi.fn(),
  recordEvents: vi.fn(),
  extend: vi.fn(),
  // Section resolution has its own tests (lib/ai-search/sections.test.ts); turns
  // here keep every retrieved source unless a test uses the real resolver.
  sections: vi.fn(
    (_pages?: unknown) =>
      (source: unknown): unknown =>
        source,
  ),
  adapter: vi.fn((runtime: { answerModel: string }) => ({ kind: runtime.answerModel })),
  extras: {
    SEARCH_CHAT_HISTORY_MESSAGES: 6,
    SEARCH_CHAT_HISTORY_MAX_TOKENS: 1500,
    SEARCH_CHAT_UTILITY_MODEL: undefined as string | undefined,
    SEARCH_CHAT_SUGGESTIONS_TIMEOUT_MS: 15_000,
  },
  request: { current: new Request('http://localhost/api/public/sites/p/chat', { method: 'POST' }) },
}));

vi.mock('@/env', () => ({ env: { SEARCH_ANSWER_MIN_CONFIDENCE: 0.2, BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-00' } }));
vi.mock('@/lib/env-extras', () => ({ envExtras: mocks.extras }));
vi.mock('hono/context-storage', () => ({ getContext: () => ({ req: { raw: mocks.request.current } }) }));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: vi.fn(async () => ({ dataTenantId: 'org-1' })) } } }));
vi.mock('./sites', () => ({ resolvePublishedAnswerContext: mocks.context, deviceFromUserAgent: () => 'desktop' }));
vi.mock('./analytics', () => ({ trackProjectEvent: mocks.track }));
vi.mock('@/lib/ai-search/runtime', () => ({ resolveChatRuntime: mocks.runtime, retrieveChatLanguages: mocks.retrieve }));
vi.mock('@/lib/ai-search/chat-budget', () => ({
  reserveChatTurn: mocks.reserve,
  extendChatTurn: mocks.extend,
  releaseChatTurn: mocks.release,
  settleChatSpend: mocks.settle,
}));
vi.mock('@/lib/ai-search/quota', () => ({ consumeAnswerQuota: mocks.quota, recordAnswerServed: mocks.served }));
vi.mock('@/lib/ai-search/sections', () => ({ publishedSections: mocks.sections }));
vi.mock('@/lib/ai-search/conversation-archive', () => ({
  recordAiChatTurn: mocks.recordTurn,
  recordAiChatFeedback: mocks.recordFeedback,
  // The real derivation is covered in conversation-archive.test.ts; here the
  // revision only has to follow the capture state and the consent config.
  readerChatPolicy: (config: unknown, captureSetting: boolean) => {
    const storesQuestions = captureSetting && mocks.storageReady;
    return {
      storesQuestions,
      questionRetentionDays: storesQuestions ? 90 : null,
      consent: 'not_required',
      revision: `rev:${storesQuestions}:${JSON.stringify(config)}`,
    };
  },
}));
vi.mock('./site-chat-events', () => ({ recordAiChatEvents: mocks.recordEvents }));
vi.mock('@nibleaf/search/workspace', async (importOriginal) => ({
  knownChatCost: (await importOriginal<typeof import('@nibleaf/search/workspace')>()).knownChatCost,
  workspaceChatAdapter: mocks.adapter,
  workspaceChatModelOptions: (await importOriginal<typeof import('@nibleaf/search/workspace')>()).workspaceChatModelOptions,
}));
// Provider calls are mocked; turn sizing is the real search package's.
vi.mock('@nibleaf/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nibleaf/search')>();
  return {
    CHAT_PROMPT_VERSION: actual.CHAT_PROMPT_VERSION,
    questionLanguage: actual.questionLanguage,
    noAnswer: actual.noAnswer,
    CHAT_OUTPUT_TOKEN_LIMITS: actual.CHAT_OUTPUT_TOKEN_LIMITS,
    boundChatHistory: actual.boundChatHistory,
    estimateTokens: actual.estimateTokens,
    CHAT_MIN_SOURCES_TOKENS: actual.CHAT_MIN_SOURCES_TOKENS,
    CHAT_SOURCES_HEADROOM_TOKENS: actual.CHAT_SOURCES_HEADROOM_TOKENS,
    chatTurnReservation: actual.chatTurnReservation,
    chatCallInputTokens: actual.chatCallInputTokens,
    chatCallInputBounds: actual.chatCallInputBounds,
    chatSourcesTokens: actual.chatSourcesTokens,
    fitChatContext: actual.fitChatContext,
    fitChatSources: actual.fitChatSources,
    sectionHeadingKey: actual.sectionHeadingKey,
    condenseFollowUp: mocks.condense,
    streamGroundedChat: mocks.stream,
    suggestFollowUps: mocks.suggest,
    citationsToSources: (citations: Array<Record<string, unknown>>) =>
      citations.map((citation) => ({ ...citation, snippet: 'snippet', direction: 'ltr' })),
    suggestedArticles: (chunks: Array<{ pageId: string; title: string; path: string }>) =>
      chunks
        .slice(0, 1)
        .map((chunk, index) => ({ id: `P${index + 1}`, pageId: chunk.pageId, title: chunk.title, path: chunk.path, snippet: 's', direction: 'ltr' })),
  };
});

import {
  CHAT_MIN_SOURCES_TOKENS,
  CHAT_OUTPUT_TOKEN_LIMITS,
  CHAT_SOURCES_HEADROOM_TOKENS,
  chatCallInputBounds,
  chatCallInputTokens,
  chatSourcesTokens,
  chatTurnReservation,
  fitChatContext,
  fitChatSources,
  type SearchChunk,
} from '@nibleaf/search';
import { aiChatConsentRequired, trustedChatConsent } from '@/lib/ai-search/chat-consent';
import { chatFeedbackToken } from '@/lib/ai-search/feedback-token';
import { chatSite, chatTurnShape, getSiteChatPolicy, recordChatRateLimited, submitSiteChatFeedback } from './site-chat';

const chunk = {
  id: 'c1',
  pageId: 'page-1',
  title: 'Install',
  path: 'guides/install',
  content: 'Run the installer.',
  heading: 'With npm',
  direction: 'ltr',
};
/** A retrieved chunk with every field the search package reads. */
const searchChunk = (index: number, content: string): SearchChunk => ({
  ...chunk,
  id: `c${index}`,
  ordinal: index,
  description: '',
  headingPath: [],
  contentHash: `h${index}`,
  language: 'en',
  direction: 'ltr',
  visible: true,
  content,
});
const context = (overrides: Record<string, unknown> = {}) => ({
  snapshot: { project: { config: {}, languages: [{ code: 'en', isDefault: true, enabled: true }] } },
  deploymentId: 'deploy-1',
  request: { configuration: { aiConversationCapture: true } },
  scope: { projectId: 'project-1', deploymentId: 'deploy-1', versionSlug: 'v1', language: 'en', visibility: 'public', allowedPageIds: null },
  available: true,
  versionPages: [
    {
      id: 'page-1',
      kind: 'PAGE',
      hidden: false,
      languageCode: 'en',
      path: 'guides/install',
      title: 'Install',
      content: '# Install\n\n## With **npm**\n\nRun the installer.\n\n## Troubleshooting\n',
    },
  ],
  ...overrides,
});
const body = (overrides: Partial<SiteChatBody> = {}): SiteChatBody => ({
  conversationId: '0b6a1d2e-7c1f-4f5e-9d8a-2b3c4d5e6f70',
  question: 'How do I install it?',
  history: [],
  consent: 'not_required',
  ...overrides,
});

const readEvents = async (response: Response) =>
  (await response.text())
    .split('\n\n')
    .map((frame) => frame.split('\n').find((line) => line.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as { type: string; name?: string; value?: unknown; delta?: string; code?: string });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Reads a response's events as they arrive, up to the first that matches. */
const readUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, done: (text: string) => boolean) => {
  const decoder = new TextDecoder();
  let text = '';
  while (!done(text)) {
    const { value, done: ended } = await reader.read();
    if (ended) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
};
const reservation = { allowed: true, turnIndex: 0, turnsRemaining: 19, reservedTokens: 9000, reservedAt: new Date('2026-11-06T10:00:00.000Z') };
/** Every content-free event recorded so far, in order. */
const recorded = () => mocks.recordEvents.mock.calls.flatMap(([, , events]) => events as Array<{ name: string } & Record<string, unknown>>);

describe('reader AI chat stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.current = new Request('http://localhost/api/public/sites/p/chat', { method: 'POST' });
    mocks.context.mockResolvedValue(context());
    mocks.runtime.mockResolvedValue({ providerId: 'openrouter', answerModel: 'openai/test-answer-model', answersEnabled: true });
    mocks.reserve.mockImplementation(async () => ({ ...reservation }));
    mocks.extend.mockImplementation(async (_project: string, _conversation: string, hold: { reservedTokens: number }, wanted: number) => {
      hold.reservedTokens += wanted;
      return wanted;
    });
    mocks.quota.mockResolvedValue({ allowed: true, remaining: 41 });
    mocks.condense.mockResolvedValue({ query: 'How do I install it?', rewritten: false });
    mocks.retrieve.mockResolvedValue({ chunks: [chunk], hits: [{ chunk, score: 0.9 }], confidence: 0.8, cacheHit: false });
    mocks.suggest.mockResolvedValue({ questions: ['Can I install it offline?'], usage: { inputTokens: 30, outputTokens: 10 } });
    mocks.recordEvents.mockResolvedValue(undefined);
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = undefined;
    mocks.extras.SEARCH_CHAT_SUGGESTIONS_TIMEOUT_MS = 15_000;
    mocks.settle.mockResolvedValue(undefined);
    mocks.release.mockResolvedValue(undefined);
    mocks.recordTurn.mockResolvedValue(undefined);
    mocks.track.mockResolvedValue(undefined);
    mocks.storageReady = true;
  });

  describe('for a reader whose page stayed open while the capture policy changed', () => {
    const answers = () =>
      mocks.stream.mockReturnValue({
        deltas: (async function* () {
          yield 'Run the installer. [S1]';
        })(),
        result: Promise.resolve({
          status: 'answered',
          answer: 'Run the installer. [S1]',
          citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install', heading: 'With npm' }],
          droppedParagraphs: 0,
          usage: { inputTokens: 100, outputTokens: 20 },
          model: 'openai/test-answer-model',
          latencyMs: 10,
          firstTokenMs: 4,
        }),
      });
    const capture = (on: boolean) => context({ request: { configuration: { aiConversationCapture: on } } });
    const refused = async (revision: string) => {
      const events = await readEvents(await chatSite('project-1', body({ policyRevision: revision })));
      expect(events.find((event) => event.name === AI_CHAT_EVENT.error)?.value).toEqual({ code: 'policy_changed' });
      expect(events.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'policy_changed' });
      // Nothing is spent, asked or kept for a turn sent under the old terms.
      for (const call of [mocks.reserve, mocks.quota, mocks.stream, mocks.recordTurn]) expect(call).not.toHaveBeenCalled();
    };

    it('refuses a turn shown "not kept" after capture was turned on, then answers it under the new revision', async () => {
      mocks.context.mockResolvedValue(capture(false));
      const shown = await getSiteChatPolicy('project-1');
      expect(shown).toMatchObject({ storesQuestions: false, questionRetentionDays: null });

      mocks.context.mockResolvedValue(capture(true));
      await refused(shown.revision);

      const current = await getSiteChatPolicy('project-1');
      expect(current).toMatchObject({ storesQuestions: true, questionRetentionDays: 90 });
      expect(current.revision).not.toBe(shown.revision);
      answers();
      const events = await readEvents(await chatSite('project-1', body({ policyRevision: current.revision })));
      expect(events.some((event) => event.name === AI_CHAT_EVENT.final)).toBe(true);
      await vi.waitFor(() => expect(mocks.recordTurn).toHaveBeenCalledWith(expect.objectContaining({ captureSetting: true })));
    });

    it('refuses a turn shown "kept for 90 days" after capture was turned off', async () => {
      const shown = await getSiteChatPolicy('project-1');
      expect(shown).toMatchObject({ storesQuestions: true, questionRetentionDays: 90 });

      mocks.context.mockResolvedValue(capture(false));
      await refused(shown.revision);
      expect((await getSiteChatPolicy('project-1')).storesQuestions).toBe(false);
    });

    it('refuses a turn when the instance stopped being able to keep questions', async () => {
      const shown = await getSiteChatPolicy('project-1');
      mocks.storageReady = false;
      await refused(shown.revision);
    });

    it('refuses a turn when the site started asking for consent', async () => {
      const shown = await getSiteChatPolicy('project-1');
      mocks.context.mockResolvedValue(context({ snapshot: { project: { config: { analytics: { cookieConsent: true } }, languages: [] } } }));
      await refused(shown.revision);
    });

    it('answers a turn from a page that sends no revision (loaded before policies existed)', async () => {
      answers();
      const events = await readEvents(await chatSite('project-1', body()));
      expect(events.some((event) => event.name === AI_CHAT_EVENT.final)).toBe(true);
    });
  });

  it('streams text, then a validated final payload that replaces it, then finishes', async () => {
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the ';
        yield 'installer. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Run the installer. [S1]',
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install', heading: 'With npm' }],
        droppedParagraphs: 0,
        usage: { inputTokens: 100, outputTokens: 20 },
        model: 'openai/test-answer-model',
        latencyMs: 10,
        firstTokenMs: 4,
      }),
    });
    const response = await chatSite('project-1', body({ pagePath: '/guides/install/' }));
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const events = await readEvents(response);
    expect(events.map((event) => (event.type === 'CUSTOM' ? `CUSTOM:${event.name}` : event.type))).toEqual([
      'RUN_STARTED',
      `CUSTOM:${AI_CHAT_EVENT.status}`,
      'TEXT_MESSAGE_START',
      `CUSTOM:${AI_CHAT_EVENT.status}`,
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_CONTENT',
      `CUSTOM:${AI_CHAT_EVENT.status}`,
      'TEXT_MESSAGE_END',
      `CUSTOM:${AI_CHAT_EVENT.final}`,
      `CUSTOM:${AI_CHAT_EVENT.followUps}`,
      'RUN_FINISHED',
    ]);
    const final = aiChatFinalEventSchema.parse(events.find((event) => event.name === AI_CHAT_EVENT.final)?.value);
    expect(final).toMatchObject({ status: 'answered', answer: 'Run the installer. [S1]', limits: { turnsRemaining: 19, quotaRemaining: 41 } });
    // Citations are the checked answer's own, from sources resolved to their sections before generation.
    expect(final.citations[0]).toMatchObject({ heading: 'With npm' });
    expect(aiChatFollowUpsEventSchema.parse(events.find((event) => event.name === AI_CHAT_EVENT.followUps)?.value)).toEqual({
      turnId: final.turnId,
      questions: ['Can I install it offline?'],
    });
    expect(final.feedbackToken).toBe(chatFeedbackToken('project-1', final.conversationId, final.turnId));
    // The page the reader asked from is passed as a narrowing hint only.
    expect(mocks.retrieve.mock.calls[0]?.[4]).toMatchObject({ page: { id: 'page-1', title: 'Install' } });
    await settle();
    // A completed answer counts toward today's answers shown on the AI answers page.
    // Counted at the time its final event went out, so a turn finishing near midnight UTC counts on that day.
    expect(mocks.served).toHaveBeenCalledWith('project-1', expect.any(Date));
    // The turn reserved the most it can read and write before it ran, measured
    // from the prompts it sends (the reader's page included), then settles to what
    // the answer and suggestion calls spent. One short source fits the least
    // documentation reserved up front, so nothing more was reserved.
    const reserved = chatTurnReservation(chatTurnShape(body(), 'en', { title: 'Install', path: 'guides/install' }));
    // Admitted only with room to read a full context on top.
    expect(mocks.reserve).toHaveBeenCalledWith('project-1', final.conversationId, reserved, undefined, CHAT_SOURCES_HEADROOM_TOKENS);
    expect(reserved).toBeGreaterThan(chatTurnReservation(chatTurnShape(body(), 'en')));
    expect(mocks.extend).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith('project-1', final.conversationId, reservation, 160);
    expect(recorded().map((event) => event.name)).toEqual(['question_asked', 'first_token', 'answer_completed']);
    expect(recorded()[0]).toMatchObject({ turnId: final.turnId, turnIndex: 0, followUp: false, pageContext: true });
    expect(recorded()[1]).toMatchObject({ ttftMs: expect.any(Number) });
    expect(recorded()[2]).toMatchObject({
      outcome: 'answered',
      provider: 'openrouter',
      model: 'openai/test-answer-model',
      inputTokens: 130,
      outputTokens: 30,
      retrievalCacheHit: false,
    });
    expect(mocks.recordEvents.mock.calls[0]?.[0]).toBe('project-1');
    expect(mocks.recordEvents.mock.calls[0]?.[1]).toMatchObject({ consent: 'not_required', language: 'en', device: 'desktop' });
    expect(mocks.recordTurn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1', status: 'answered', turnId: final.turnId, pagePath: 'guides/install', inputTokens: 130 }),
    );
    expect(mocks.track).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ name: 'answer_completed', promptTokens: 130 }),
      expect.anything(),
    );
  });

  it('gives the model only sources resolved to a section the published page renders', async () => {
    const actual = await vi.importActual<typeof import('@/lib/ai-search/sections')>('@/lib/ai-search/sections');
    mocks.sections.mockImplementationOnce((pages?: unknown) => actual.publishedSections(pages as never) as (source: unknown) => unknown);
    const indexed = { ...searchChunk(1, 'Run the installer.'), heading: 'With npm', anchor: 'with-npm' };
    const unknownSection = { ...searchChunk(2, 'An old section.'), heading: 'Removed section', headingPath: ['Removed section'] };
    const otherPage = { ...searchChunk(3, 'Not in this version.'), pageId: 'page-from-another-version' };
    mocks.retrieve.mockResolvedValue({ chunks: [indexed, unknownSection, otherPage], hits: [], confidence: 0.8, cacheHit: false });
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        // A declined answer streams no text.
      })(),
      result: Promise.resolve({ status: 'no_answer', answer: 'No.', citations: [], droppedParagraphs: 0, model: 'm', latencyMs: 1 }),
    });
    await readEvents(await chatSite('project-1', body()));
    const read = mocks.stream.mock.calls[0]?.[0].chunks as SearchChunk[];
    // The section's heading as the table of contents shows it (inline Markdown stripped), and its rendered id.
    expect(read.map(({ id, heading, anchor }) => ({ id, heading, anchor }))).toEqual([{ id: 'c1', heading: 'With npm', anchor: 'with-npm' }]);
  });

  it('uses the Arabic question language throughout a turn on an English reader', async () => {
    const events = await readEvents(await chatSite('project-1', body({ question: 'كيف أضيف مستخدم جديد؟' })));
    expect(mocks.condense.mock.calls[0]?.[0]).toMatchObject({ language: 'ar' });
    expect(mocks.retrieve.mock.calls[0]?.[4]).toMatchObject({ language: 'ar' });
    expect(mocks.stream.mock.calls[0]?.[0]).toMatchObject({ language: 'ar' });
    expect(events.find((event) => event.name === AI_CHAT_EVENT.final)?.value).toMatchObject({ language: 'ar' });
  });

  it('returns an Arabic no-answer with no citations or articles on an English reader', async () => {
    mocks.retrieve.mockResolvedValue({ chunks: [chunk], hits: [], confidence: 0.05 });
    const events = await readEvents(await chatSite('project-1', body({ question: 'كيف أضيف مستخدم جديد؟' })));
    const final = aiChatFinalEventSchema.parse(events.find((event) => event.name === AI_CHAT_EVENT.final)?.value);
    expect(final).toMatchObject({ status: 'no_answer', language: 'ar', citations: [], suggestions: [] });
    expect(final.answer).toContain('لم أجد إجابة واضحة');
  });

  it('never calls the model or attaches articles when retrieval is not confident', async () => {
    mocks.retrieve.mockResolvedValue({ chunks: [chunk], hits: [{ chunk, score: 0.05 }], confidence: 0.05 });
    const events = await readEvents(await chatSite('project-1', body()));
    expect(mocks.stream).not.toHaveBeenCalled();
    const final = aiChatFinalEventSchema.parse(events.find((event) => event.name === AI_CHAT_EVENT.final)?.value);
    expect(final).toMatchObject({ status: 'no_answer', noAnswerReason: 'low_confidence', citations: [] });
    expect(final.suggestions).toHaveLength(0);
    expect(final.supportUrl).toBeUndefined();
    expect(events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')).toHaveLength(1);
    expect(mocks.suggest).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) await settle();
    // Nothing was billed, and that is known: the turn cost exactly nothing.
    const turn = mocks.recordTurn.mock.calls.at(-1)?.[0];
    expect(turn).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(turn).not.toHaveProperty('usageEstimated');
    expect(turn).not.toHaveProperty('utilityModel');
    expect(mocks.extend).not.toHaveBeenCalled();
    expect(mocks.settle.mock.calls.at(-1)?.[3]).toBe(0);
  });

  it('records a low-confidence follow-up as known: the rewrite on the utility model, nothing on the answer model', async () => {
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = 'openai/test-utility-model';
    mocks.adapter.mockImplementation((runtime: { answerModel: string }, sink?: Record<string, number>) => {
      if (sink && runtime.answerModel === 'openai/test-utility-model') Object.assign(sink, { costUsd: 0.0001, calls: 1, costed: 1 });
      return { kind: runtime.answerModel };
    });
    mocks.condense.mockResolvedValue({ query: 'install', rewritten: true, usage: { inputTokens: 50, outputTokens: 10 } });
    mocks.retrieve.mockResolvedValue({ chunks: [chunk], hits: [{ chunk, score: 0.05 }], confidence: 0.05 });
    await readEvents(await chatSite('project-1', body({ history: [{ role: 'user', content: 'npm' }] })));
    for (let i = 0; i < 3; i++) await settle();
    const turn = mocks.recordTurn.mock.calls.at(-1)?.[0];
    expect(turn).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      utilityModel: 'openai/test-utility-model',
      utilityInputTokens: 50,
      utilityOutputTokens: 10,
      utilityCostUsd: 0.0001,
    });
    expect(turn).not.toHaveProperty('usageEstimated');
    expect(turn).not.toHaveProperty('utilityUsageEstimated');
    mocks.adapter.mockImplementation((runtime: { answerModel: string }) => ({ kind: runtime.answerModel }));
  });

  it('offers the site support link and section-level articles when the docs do not cover it', async () => {
    mocks.context.mockResolvedValue(
      context({ request: { configuration: { aiConversationCapture: true, aiSupportUrl: 'mailto:help@example.com' } } }),
    );
    mocks.retrieve.mockResolvedValue({ chunks: [chunk], hits: [{ chunk, score: 0.05 }], confidence: 0.05, cacheHit: true });
    const events = await readEvents(await chatSite('project-1', body()));
    const final = aiChatFinalEventSchema.parse(events.find((event) => event.name === AI_CHAT_EVENT.final)?.value);
    expect(final).toMatchObject({ status: 'no_answer', supportUrl: 'mailto:help@example.com' });
    expect(events.some((event) => event.name === AI_CHAT_EVENT.followUps)).toBe(false);
    await settle();
    expect(recorded().at(-1)).toMatchObject({ name: 'answer_completed', outcome: 'no_answer', reason: 'low_confidence', retrievalCacheHit: true });
  });

  it('sends the checked answer before its suggestions, which read it, and reports a failed suggestion call', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.suggest.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the installer. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Run the installer. [S1]',
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
        droppedParagraphs: 0,
        usage: { inputTokens: 900, outputTokens: 120 },
        model: 'openai/test-answer-model',
      }),
    });
    const started = performance.now();
    const reader = (await chatSite('project-1', body())).body?.getReader();
    if (!reader) throw new Error('expected a stream');
    // The final answer arrives while the suggestions call is still running.
    const first = await readUntil(reader, (text) => text.includes(AI_CHAT_EVENT.final));
    const answeredMs = performance.now() - started;
    expect(first).toContain(AI_CHAT_EVENT.final);
    expect(first).not.toContain('RUN_FINISHED');
    expect(mocks.suggest.mock.calls[0]?.[0]).toMatchObject({ answer: 'Run the installer. [S1]' });
    // Suggestions take a while; the answer time does not include them.
    await new Promise((resolve) => setTimeout(resolve, 250));
    finish({ questions: [], failed: true });
    const rest = await readUntil(reader, () => false);
    expect(rest).toContain('RUN_FINISHED');
    expect(rest).not.toContain(AI_CHAT_EVENT.followUps);
    for (let i = 0; i < 3; i++) await settle();
    expect(recorded()).toContainEqual(expect.objectContaining({ name: 'provider_error', phase: 'follow_ups' }));
    // The recorded latency ends with the answer: no longer than this test saw the
    // answer take (plus rounding), so the 250 ms the suggestions took is not in it.
    const latencyMs = Number(mocks.recordTurn.mock.calls.at(-1)?.[0].latencyMs);
    expect(latencyMs).toBeLessThanOrEqual(Math.round(answeredMs) + 1);
    expect(recorded().at(-1)).toMatchObject({ name: 'answer_completed', latencyMs });
  });

  it('ends a suggestions call that takes too long and reports it, after the answer', async () => {
    mocks.extras.SEARCH_CHAT_SUGGESTIONS_TIMEOUT_MS = 30;
    // Like suggestFollowUps: a call that never answers settles when its signal aborts,
    // as failed when it timed out.
    mocks.suggest.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) =>
          signal.addEventListener(
            'abort',
            () => resolve({ questions: [], ...((signal.reason as { name?: string })?.name === 'TimeoutError' ? { failed: true } : {}) }),
            { once: true },
          ),
        ),
    );
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the installer. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Run the installer. [S1]',
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
        droppedParagraphs: 0,
        usage: { inputTokens: 900, outputTokens: 120 },
        model: 'openai/test-answer-model',
      }),
    });
    const events = await readEvents(await chatSite('project-1', body()));
    expect(events.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
    expect(events.some((event) => event.name === AI_CHAT_EVENT.followUps)).toBe(false);
    await settle();
    expect(recorded()).toContainEqual(expect.objectContaining({ name: 'provider_error', phase: 'follow_ups' }));
  });

  it('asks for no suggestions after a declined answer', async () => {
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        // The model declines without streaming any text.
      })(),
      result: Promise.resolve({
        status: 'no_answer',
        noAnswerReason: 'unverified',
        answer: 'x',
        citations: [],
        droppedParagraphs: 0,
        model: 'm',
        latencyMs: 1,
      }),
    });
    const events = await readEvents(await chatSite('project-1', body()));
    expect(events.some((event) => event.name === AI_CHAT_EVENT.followUps)).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
    // Suggestions follow a checked answer; a declined one gets none, and none are paid for.
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('routes rewriting and suggestions to the utility model on OpenRouter only', async () => {
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = 'openai/test-utility-model';
    mocks.condense.mockResolvedValue({ query: 'install', rewritten: true, failed: true });
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the installer. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Run the installer. [S1]',
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
        droppedParagraphs: 0,
        model: 'm',
        latencyMs: 1,
      }),
    });
    await readEvents(await chatSite('project-1', body({ history: [{ role: 'user', content: 'npm' }] })));
    expect(mocks.condense.mock.calls[0]?.[0]).toMatchObject({ adapter: { kind: 'openai/test-utility-model' } });
    expect(mocks.suggest.mock.calls[0]?.[0]).toMatchObject({ adapter: { kind: 'openai/test-utility-model' } });
    expect(mocks.stream.mock.calls[0]?.[0]).toMatchObject({ adapter: { kind: 'openai/test-answer-model' } });
    await settle();
    expect(recorded()).toContainEqual(expect.objectContaining({ name: 'provider_error', phase: 'condense' }));
    expect(recorded()[0]).toMatchObject({ name: 'question_asked', followUp: true });

    mocks.adapter.mockClear();
    mocks.runtime.mockResolvedValue({ providerId: 'openai', answerModel: 'test-answer-model', answersEnabled: true });
    await readEvents(await chatSite('project-1', body()));
    expect(mocks.adapter).toHaveBeenCalledTimes(1);
  });

  it("records a separate utility model's usage and cost apart from the answer model's", async () => {
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = 'openai/test-utility-model';
    // Each model's provider-reported cost lands in its own sink.
    mocks.adapter.mockImplementation((runtime: { answerModel: string }, sink?: Record<string, number>) => {
      if (sink) Object.assign(sink, { costUsd: runtime.answerModel === 'openai/test-utility-model' ? 0.0001 : 0.002, calls: 1, costed: 1 });
      return { kind: runtime.answerModel };
    });
    mocks.condense.mockResolvedValue({ query: 'install', rewritten: true, usage: { inputTokens: 50, outputTokens: 10 } });
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the installer. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Run the installer. [S1]',
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
        droppedParagraphs: 0,
        usage: { inputTokens: 900, outputTokens: 120 },
        model: 'openai/test-answer-model',
      }),
    });
    await readEvents(await chatSite('project-1', body({ history: [{ role: 'user', content: 'npm' }] })));
    await settle();
    expect(mocks.recordTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/test-answer-model',
        inputTokens: 900,
        outputTokens: 120,
        costUsd: 0.002,
        utilityModel: 'openai/test-utility-model',
        utilityInputTokens: 80,
        utilityOutputTokens: 20,
        utilityCostUsd: 0.0001,
      }),
    );
    // Budgets count both models; the event reports the model it names.
    expect(mocks.settle.mock.calls.at(-1)?.[3]).toBe(1120);
    expect(recorded().at(-1)).toMatchObject({ name: 'answer_completed', model: 'openai/test-answer-model', inputTokens: 900, costUsd: 0.002 });

    // Naming the answer model as the utility model is not a separate model.
    mocks.recordTurn.mockClear();
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = 'openai/test-answer-model';
    await readEvents(await chatSite('project-1', body({ history: [{ role: 'user', content: 'npm' }] })));
    await settle();
    expect(mocks.recordTurn.mock.calls.at(-1)?.[0]).not.toHaveProperty('utilityModel');
    mocks.adapter.mockImplementation((runtime: { answerModel: string }) => ({ kind: runtime.answerModel }));
  });

  it("keeps the answer model's reported usage and cost when only the utility model's suggestions went unreported", async () => {
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = 'openai/test-utility-model';
    mocks.adapter.mockImplementation((runtime: { answerModel: string }, sink?: Record<string, number>) => {
      if (sink) Object.assign(sink, { costUsd: runtime.answerModel === 'openai/test-utility-model' ? 0.0001 : 0.002, calls: 1, costed: 1 });
      return { kind: runtime.answerModel };
    });
    mocks.condense.mockResolvedValue({ query: 'install', rewritten: true, usage: { inputTokens: 50, outputTokens: 10 } });
    // The suggestions call failed before reporting usage.
    mocks.suggest.mockResolvedValue({ questions: [], failed: true });
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the installer. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Run the installer. [S1]',
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
        droppedParagraphs: 0,
        usage: { inputTokens: 900, outputTokens: 120 },
        model: 'openai/test-answer-model',
      }),
    });
    await readEvents(await chatSite('project-1', body({ history: [{ role: 'user', content: 'npm' }] })));
    for (let i = 0; i < 3; i++) await settle();
    const turn = mocks.recordTurn.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(turn).toMatchObject({
      inputTokens: 900,
      outputTokens: 120,
      costUsd: 0.002,
      utilityModel: 'openai/test-utility-model',
      utilityUsageEstimated: true,
    });
    expect(turn).not.toHaveProperty('usageEstimated');
    expect(turn).not.toHaveProperty('utilityCostUsd');
    // The utility model's figures include an estimate for the unreported suggestions call.
    expect(Number(turn.utilityInputTokens)).toBeGreaterThan(50);
    // The answer model's reported facts still reach the event that names it.
    expect(recorded().at(-1)).toMatchObject({ name: 'answer_completed', inputTokens: 900, outputTokens: 120, costUsd: 0.002 });
    mocks.adapter.mockImplementation((runtime: { answerModel: string }) => ({ kind: runtime.answerModel }));
  });

  it('leaves cost unknown when a billed response never reported one, keeping its reported tokens', async () => {
    // Two billed responses (rewrite and answer), only one of them with a readable cost.
    mocks.adapter.mockImplementation((_runtime: unknown, sink?: Record<string, number>) => {
      if (sink) Object.assign(sink, { costUsd: 0.002, calls: 2, costed: 1 });
      return { kind: 'openai/test-answer-model' };
    });
    mocks.condense.mockResolvedValue({ query: 'install', rewritten: true, usage: { inputTokens: 50, outputTokens: 10 } });
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the installer. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Run the installer. [S1]',
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
        droppedParagraphs: 0,
        usage: { inputTokens: 900, outputTokens: 120 },
        model: 'openai/test-answer-model',
      }),
    });
    await readEvents(await chatSite('project-1', body({ history: [{ role: 'user', content: 'npm' }] })));
    for (let i = 0; i < 3; i++) await settle();
    const turn = mocks.recordTurn.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(turn).toMatchObject({ inputTokens: 980, outputTokens: 140 });
    expect(turn).not.toHaveProperty('costUsd');
    expect(turn).not.toHaveProperty('usageEstimated');
    expect(recorded().at(-1)).not.toHaveProperty('costUsd');
    mocks.adapter.mockImplementation((runtime: { answerModel: string }) => ({ kind: runtime.answerModel }));
  });

  it('uses no-reasoning utility calls while keeping answer reasoning separate', async () => {
    await readEvents(await chatSite('project-1', body()));
    expect(mocks.condense.mock.calls[0]?.[0].modelOptions(120)).toMatchObject({ reasoning: { effort: 'none' } });
    expect(mocks.suggest.mock.calls[0]?.[0].modelOptions(400)).toMatchObject({ reasoning: { effort: 'none' } });
    expect(mocks.stream.mock.calls[0]?.[0].modelOptions(1200)).toMatchObject({ reasoning: { effort: 'low' } });
  });

  it('offers related retrieved sections after cited ones for follow-up questions', async () => {
    const synced = { ...searchChunk(0, 'Sign out and sign back in.'), pageId: 'sync', title: 'Fix sync problems' };
    const install = { ...searchChunk(1, 'Install the CLI with npm.'), pageId: 'install', title: 'Install the CLI' };
    mocks.retrieve.mockResolvedValue({ chunks: [synced, install], hits: [], confidence: 0.8, cacheHit: false });
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Sign out and sign back in. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Sign out and sign back in. [S1]',
        citations: [{ id: 'S1', pageId: 'sync', title: 'Fix sync problems', path: 'fix-sync' }],
        droppedParagraphs: 0,
        usage: { inputTokens: 100, outputTokens: 20 },
        model: 'm',
      }),
    });
    await readEvents(await chatSite('project-1', body()));
    expect(mocks.suggest.mock.calls[0]?.[0].chunks.map((item: SearchChunk) => item.pageId)).toEqual(['sync', 'install']);
  });

  it('answers and suggests from the sources that fit the context budget, and estimates them as sent', async () => {
    const sources: SearchChunk[] = Array.from({ length: 12 }, (_, index) => ({
      ...chunk,
      id: `c${index}`,
      ordinal: index,
      description: '',
      headingPath: [],
      contentHash: `h${index}`,
      language: 'ar',
      direction: 'rtl',
      visible: true,
      content: 'ش'.repeat(2100),
    }));
    mocks.retrieve.mockResolvedValue({ chunks: sources, hits: [], confidence: 0.8, cacheHit: false });
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the installer. [S1]';
      })(),
      // A provider that reports no usage: the answer is recorded at its estimate.
      result: Promise.resolve({ status: 'answered', answer: 'Run the installer. [S1]', citations: [], droppedParagraphs: 0, model: 'm' }),
    });
    await readEvents(await chatSite('project-1', body()));
    for (let i = 0; i < 3; i++) await settle();
    const read = fitChatContext(sources);
    expect(read.length).toBeLessThan(sources.length);
    expect(mocks.suggest.mock.calls[0]?.[0].chunks).toEqual(read);
    expect(mocks.stream.mock.calls[0]?.[0].chunks).toEqual(read);
    // Reading them was reserved beyond the least reserved up front.
    const shape = chatTurnShape(body(), 'en');
    expect(mocks.extend.mock.calls[0]?.[3]).toBe(chatSourcesTokens(shape, read) - CHAT_MIN_SOURCES_TOKENS);
    const turn = mocks.recordTurn.mock.calls.at(-1)?.[0] as Record<string, number | boolean>;
    expect(turn.usageEstimated).toBe(true);
    // The record counts the sources the answer read, not every chunk retrieval found.
    expect(turn.chunkCount).toBe(read.length);
    // The record: reported suggestions plus the answer's estimated prompt as sent.
    expect(turn.inputTokens).toBe(30 + chatCallInputTokens(shape, read).generation);
    // The budgets: never charged more than the turn reserved.
    const [, , hold, charged] = mocks.settle.mock.calls.at(-1) ?? [];
    expect(charged).toBe(40 + chatCallInputBounds(shape, read).generation + CHAT_OUTPUT_TOKEN_LIMITS.answer);
    expect(charged).toBeLessThanOrEqual(hold.reservedTokens);
  });

  it('reads fewer sources when the budgets have less room, and still answers an admitted question', async () => {
    const sources = Array.from({ length: 6 }, (_, index) => searchChunk(index, 'x'.repeat(2000)));
    mocks.retrieve.mockResolvedValue({ chunks: sources, hits: [], confidence: 0.8, cacheHit: false });
    const shape = chatTurnShape(body(), 'en');
    for (const granted of [1000, 0, 'unavailable'] as const) {
      mocks.stream.mockClear();
      mocks.extend.mockImplementationOnce(async (_project: string, _conversation: string, hold: { reservedTokens: number }) => {
        // Redis down: the turn reads the least it reserved up front.
        if (granted === 'unavailable') throw new Error('redis down');
        hold.reservedTokens += granted;
        return granted;
      });
      mocks.stream.mockReturnValue({
        deltas: (async function* () {
          yield 'Run the installer. [S1]';
        })(),
        result: Promise.resolve({
          status: 'answered',
          answer: 'Run the installer. [S1]',
          citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
          droppedParagraphs: 0,
          usage: { inputTokens: 900, outputTokens: 120 },
          model: 'openai/test-answer-model',
        }),
      });
      await readEvents(await chatSite('project-1', body()));
      for (let i = 0; i < 3; i++) await settle();
      const read = mocks.stream.mock.calls[0]?.[0].chunks as SearchChunk[];
      const room = CHAT_MIN_SOURCES_TOKENS + (granted === 'unavailable' ? 0 : granted);
      expect(read).toEqual(fitChatSources(shape, sources, room));
      expect(read.length).toBeGreaterThan(0);
      expect(read.length).toBeLessThan(sources.length);
      expect(chatSourcesTokens(shape, read)).toBeLessThanOrEqual(room);
      expect(mocks.recordTurn.mock.calls.at(-1)?.[0]).toMatchObject({ chunkCount: read.length });
    }
  });

  it("keeps an answered turn and its suggestions' reported usage when the reader leaves before they arrive", async () => {
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = 'openai/test-utility-model';
    mocks.adapter.mockImplementation((runtime: { answerModel: string }, sink?: Record<string, number>) => {
      if (sink && runtime.answerModel === 'openai/test-utility-model') Object.assign(sink, { costUsd: 0.000_123, calls: 1, costed: 1 });
      return { kind: runtime.answerModel };
    });
    const leave = new AbortController();
    mocks.request.current = new Request('http://localhost/api/public/sites/p/chat', { method: 'POST', signal: leave.signal });
    // The provider reports the suggestions' usage just as the reader leaves.
    mocks.suggest.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve({ questions: [], usage: { inputTokens: 37, outputTokens: 11 } }), { once: true }),
        ),
    );
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the installer. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Run the installer. [S1]',
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
        droppedParagraphs: 0,
        usage: { inputTokens: 900, outputTokens: 120 },
        model: 'openai/test-answer-model',
      }),
    });
    const reader = (await chatSite('project-1', body())).body?.getReader();
    if (!reader) throw new Error('expected a stream');
    await readUntil(reader, (text) => text.includes(AI_CHAT_EVENT.final));
    leave.abort();
    await reader.cancel().catch(() => undefined);
    for (let i = 0; i < 5; i++) await settle();
    const turn = mocks.recordTurn.mock.calls.at(-1)?.[0];
    expect(turn).toMatchObject({ status: 'answered', utilityInputTokens: 37, utilityOutputTokens: 11, utilityCostUsd: 0.000_123 });
    // The reader got the checked answer before leaving: it counts.
    expect(mocks.served).toHaveBeenCalledWith('project-1', expect.any(Date));
    expect(turn).not.toHaveProperty('usageEstimated');
    expect(turn).not.toHaveProperty('utilityUsageEstimated');
    mocks.adapter.mockImplementation((runtime: { answerModel: string }) => ({ kind: runtime.answerModel }));
  });

  it('does not count an answered turn whose reader left before the final event', async () => {
    const leave = new AbortController();
    mocks.request.current = new Request('http://localhost/api/public/sites/p/chat', { method: 'POST', signal: leave.signal });
    // The checked result is in (the turn is "answered"), but the reader leaves
    // when the text ends, before the final event that carries it.
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the installer. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Run the installer. [S1]',
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
        droppedParagraphs: 0,
        usage: { inputTokens: 900, outputTokens: 120 },
        model: 'openai/test-answer-model',
      }),
    });
    const reader = (await chatSite('project-1', body())).body?.getReader();
    if (!reader) throw new Error('expected a stream');
    const seen = await readUntil(reader, (text) => text.includes('TEXT_MESSAGE_END'));
    leave.abort();
    await reader.cancel().catch(() => undefined);
    for (let i = 0; i < 5; i++) await settle();
    expect(seen).not.toContain(AI_CHAT_EVENT.final);
    expect(mocks.recordTurn.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'answered' });
    expect(mocks.served).not.toHaveBeenCalled();
  });

  it.each(['failed', 'cancelled'] as const)('starts no suggestions for an answer that is %s', async (status) => {
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = 'openai/test-utility-model';
    mocks.adapter.mockImplementation((runtime: { answerModel: string }, sink?: Record<string, number>) => {
      if (sink && runtime.answerModel === 'openai/test-utility-model') Object.assign(sink, { costUsd: 0.000_123, calls: 1, costed: 1 });
      return { kind: runtime.answerModel };
    });
    const reader = new AbortController();
    mocks.request.current = new Request('http://localhost/api/public/sites/p/chat', { method: 'POST', signal: reader.signal });
    // Suggestions finish first, with their usage reported.
    mocks.suggest.mockResolvedValue({ questions: ['Can I install it offline?'], usage: { inputTokens: 37, outputTokens: 11 } });
    let rejectResult: (error: Error) => void = () => undefined;
    const result = new Promise((_, reject) => {
      rejectResult = reject;
    });
    // Like streamGroundedChat: an aborted result rejects, with a handler attached.
    result.catch(() => undefined);
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        await new Promise((resolve) => setTimeout(resolve, 0));
        yield 'Run the ';
        if (status === 'failed') throw new Error('provider down');
        reader.abort();
        rejectResult(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      })(),
      result,
    });
    await readEvents(await chatSite('project-1', body())).catch(() => []);
    for (let i = 0; i < 5; i++) await settle();
    const turn = mocks.recordTurn.mock.calls.at(-1)?.[0];
    expect(turn).toMatchObject({ status, usageEstimated: true });
    // Nothing ran on the utility model (a first question makes no rewrite call).
    expect(mocks.suggest).not.toHaveBeenCalled();
    expect(turn).not.toHaveProperty('utilityModel');
    mocks.adapter.mockImplementation((runtime: { answerModel: string }) => ({ kind: runtime.answerModel }));
  });

  it.each([
    ['conversation_limit', () => mocks.reserve.mockResolvedValue({ allowed: false, reason: 'conversation_limit' })],
    ['budget_exhausted', () => mocks.reserve.mockResolvedValue({ allowed: false, reason: 'budget_exhausted' })],
    ['quota_exhausted', () => mocks.quota.mockResolvedValue({ allowed: false, remaining: 0 })],
    ['unavailable', () => mocks.quota.mockRejectedValue(new Error('redis down'))],
    ['unavailable', () => mocks.context.mockResolvedValue(context({ available: false }))],
  ])('reports %s in-band without calling the provider', async (code, arrange) => {
    arrange();
    const events = await readEvents(await chatSite('project-1', body()));
    expect(events.at(-2)).toMatchObject({ type: 'CUSTOM', name: AI_CHAT_EVENT.error, value: { code } });
    expect(events.at(-1)).toMatchObject({ type: 'RUN_ERROR', code });
    expect(mocks.condense).not.toHaveBeenCalled();
    await settle();
    const kind = (
      { conversation_limit: 'conversation_limit', budget_exhausted: 'token_budget', quota_exhausted: 'daily_quota' } as Record<string, string>
    )[code];
    expect(recorded()).toEqual([
      ...(kind ? [expect.objectContaining({ name: 'quota_reached', kind })] : []),
      expect.objectContaining({ name: 'answer_completed', outcome: 'blocked', reason: code }),
    ]);
  });

  it('releases the reserved turn when the daily quota refuses it', async () => {
    mocks.quota.mockResolvedValue({ allowed: false, remaining: 0 });
    await readEvents(await chatSite('project-1', body()));
    expect(mocks.release).toHaveBeenCalledWith('project-1', '0b6a1d2e-7c1f-4f5e-9d8a-2b3c4d5e6f70', reservation);
  });

  it('charges a stopped follow-up for its interrupted answer, flagged as an estimate', async () => {
    const reader = new AbortController();
    mocks.request.current = new Request('http://localhost/api/public/sites/p/chat', { method: 'POST', signal: reader.signal });
    mocks.condense.mockResolvedValue({ query: 'Export one notebook', rewritten: true, usage: { inputTokens: 88, outputTokens: 12 } });
    mocks.retrieve.mockResolvedValue({
      chunks: Array.from({ length: 12 }, (_, index) => ({ ...chunk, id: `c${index}`, content: 'x'.repeat(900) })),
      hits: [],
      confidence: 0.8,
      cacheHit: false,
    });
    // Like suggestFollowUps: a stopped suggestions call settles without usage.
    mocks.suggest.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => signal.addEventListener('abort', () => resolve({ questions: [] }), { once: true })),
    );
    let rejectResult: (error: Error) => void = () => undefined;
    const result = new Promise((_, reject) => {
      rejectResult = reject;
    });
    // Like streamGroundedChat: an aborted result rejects, with a handler attached.
    result.catch(() => undefined);
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run acme export with ';
        reader.abort();
      })(),
      result,
    });
    const history = [
      { role: 'user' as const, content: 'How do I export?' },
      { role: 'assistant' as const, content: 'Use More, then Export.' },
    ];
    const response = await chatSite('project-1', body({ question: 'And only one notebook?', history }));
    rejectResult(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await readEvents(response).catch(() => []);
    for (let i = 0; i < 5; i++) await settle();
    const turn = mocks.recordTurn.mock.calls.at(-1)?.[0] as Record<string, number | boolean | string>;
    expect(turn).toMatchObject({ status: 'cancelled', usageEstimated: true });
    // Far more than the rewrite's 100 tokens: the answer read the question, history and 12 sources.
    expect(Number(turn.inputTokens)).toBeGreaterThan(3600);
    // Budgets are charged the rewrite's reported 100 tokens and, for the stopped
    // answer, the most it could have used; the record keeps estimates. A stopped
    // answer starts no suggestions.
    const spent = mocks.settle.mock.calls.at(-1)?.[3] as number;
    const read = mocks.stream.mock.calls[0]?.[0].chunks as SearchChunk[];
    expect(read).toHaveLength(12);
    const bounds = chatCallInputBounds(chatTurnShape(body({ question: 'And only one notebook?', history }), 'en'), read);
    expect(spent).toBe(100 + bounds.generation + CHAT_OUTPUT_TOKEN_LIMITS.answer);
    expect(mocks.suggest).not.toHaveBeenCalled();
    expect(spent).toBeGreaterThan(Number(turn.inputTokens) + Number(turn.outputTokens));
    // Analytics events carry provider-reported facts only.
    expect(recorded().at(-1)).toMatchObject({ name: 'answer_completed', outcome: 'cancelled' });
    expect(recorded().at(-1)).not.toHaveProperty('inputTokens');
  });

  it('uses the consent the site requires, not the one the client claims, for every record', async () => {
    mocks.context.mockResolvedValue(
      context({ snapshot: { project: { config: { analytics: { cookieConsent: true, ga4: 'G-ABC123' } }, languages: [] } } }),
    );
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Run the installer. [S1]';
      })(),
      result: Promise.resolve({
        status: 'answered',
        answer: 'Run the installer. [S1]',
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
        droppedParagraphs: 0,
        usage: { inputTokens: 100, outputTokens: 20 },
        model: 'openai/test-answer-model',
      }),
    });
    await readEvents(await chatSite('project-1', body({ consent: 'not_required', sessionId: 'reader-session-0001' })));
    await settle();
    expect(mocks.recordTurn).toHaveBeenCalledWith(expect.objectContaining({ consent: 'unknown', consentRequired: true }));
    expect(mocks.recordEvents.mock.calls[0]?.[1]).toMatchObject({ consent: 'unknown' });
    for (const call of mocks.track.mock.calls) expect(call[2]).toMatchObject({ consentState: 'unknown' });
  });

  it('records a rate-limited request for a published site, and nothing for an unknown one', async () => {
    const limited = body({ consent: 'granted', sessionId: 'reader-session-0001' });
    await recordChatRateLimited('project-1', limited, new Headers({ 'user-agent': 'Mozilla/5.0' }));
    expect(recorded()).toEqual([
      expect.objectContaining({ name: 'quota_reached', kind: 'rate_limited', conversationId: limited.conversationId }),
      expect.objectContaining({ name: 'answer_completed', outcome: 'blocked', reason: 'rate_limited' }),
    ]);
    expect(mocks.recordEvents.mock.calls[0]?.[1]).toMatchObject({ consent: 'granted', sessionId: 'reader-session-0001' });
    // An invalid body still records under a valid conversation id, or the analytics
    // pipeline would reject the batch.
    mocks.recordEvents.mockClear();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    await recordChatRateLimited('project-1', { conversationId: limited.conversationId, question: 'x' }, new Headers());
    expect(recorded()[0]).toMatchObject({ name: 'quota_reached', conversationId: limited.conversationId });
    mocks.recordEvents.mockClear();
    await recordChatRateLimited('project-1', { nonsense: true }, new Headers());
    expect(recorded().map((event) => event.conversationId)).toEqual([expect.stringMatching(uuid), expect.stringMatching(uuid)]);
    mocks.recordEvents.mockClear();
    mocks.context.mockRejectedValue(new Error('not found'));
    await expect(recordChatRateLimited('missing-site', { nonsense: true }, new Headers())).resolves.toBeUndefined();
    expect(mocks.recordEvents).not.toHaveBeenCalled();
  });

  it('closes the open message and fails generically when the provider breaks', async () => {
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        yield 'Partial';
        throw new Error('provider said: secret upstream detail');
      })(),
      result: new Promise(() => undefined),
    });
    const events = await readEvents(await chatSite('project-1', body()));
    expect(events.map((event) => event.type).slice(-3)).toEqual(['TEXT_MESSAGE_END', 'CUSTOM', 'RUN_ERROR']);
    expect(JSON.stringify(events)).not.toContain('secret upstream detail');
    await settle();
    expect(mocks.recordTurn).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(recorded()).toContainEqual(expect.objectContaining({ name: 'provider_error', phase: 'generation' }));
    expect(recorded().at(-1)).toMatchObject({ name: 'answer_completed', outcome: 'failed' });
    // A failed generation spent quota but is not a served answer.
    expect(mocks.served).not.toHaveBeenCalled();
  });

  it('ignores a page context the reader cannot see', async () => {
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        // The model declines without streaming any text.
      })(),
      result: Promise.resolve({
        status: 'no_answer',
        noAnswerReason: 'model_declined',
        answer: 'No.',
        citations: [],
        droppedParagraphs: 0,
        model: 'm',
        latencyMs: 1,
      }),
    });
    await readEvents(await chatSite('project-1', body({ pagePath: 'internal/secret' })));
    expect(mocks.retrieve.mock.calls[0]?.[4]).toMatchObject({ page: undefined });
  });
});

describe('reader AI chat feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue(context());
    mocks.recordFeedback.mockResolvedValue(undefined);
    mocks.recordEvents.mockResolvedValue(undefined);
    mocks.track.mockResolvedValue(undefined);
  });

  it('rejects ratings without the proof issued with the answer', async () => {
    await expect(
      submitSiteChatFeedback('project-1', {
        conversationId: '0b6a1d2e-7c1f-4f5e-9d8a-2b3c4d5e6f70',
        turnId: '1b6a1d2e-7c1f-4f5e-9d8a-2b3c4d5e6f71',
        token: 'x'.repeat(43),
        rating: 'down',
        consent: 'unknown',
      }),
    ).rejects.toMatchObject({ code: 'http:forbidden' });
    expect(mocks.recordFeedback).not.toHaveBeenCalled();
  });

  it('stores an editable rating and emits the content-free feedback event', async () => {
    const conversationId = '0b6a1d2e-7c1f-4f5e-9d8a-2b3c4d5e6f70';
    const turnId = '1b6a1d2e-7c1f-4f5e-9d8a-2b3c4d5e6f71';
    await expect(
      submitSiteChatFeedback('project-1', {
        conversationId,
        turnId,
        token: chatFeedbackToken('project-1', conversationId, turnId),
        rating: 'down',
        reason: 'outdated',
        comment: 'The flag was renamed.',
        consent: 'granted',
      }),
    ).resolves.toEqual({ saved: true });
    expect(mocks.recordFeedback).toHaveBeenCalledWith(expect.objectContaining({ rating: 'down', reason: 'outdated', language: 'en' }));
    expect(mocks.track).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ name: 'feedback_submitted', feedback: 'not_helpful' }),
      expect.anything(),
    );
    expect(recorded()).toEqual([expect.objectContaining({ name: 'feedback_given', rating: 'down', reason: 'outdated', turnId })]);
    expect(JSON.stringify(recorded())).not.toContain('renamed');
  });

  it.each([
    ['up', 'down', 'feedback_changed'],
    [null, 'up', 'feedback_changed'],
    [null, null, undefined],
    ['down', 'down', undefined],
  ] as const)('records rating %s after %s as %s', async (rating, previousRating, name) => {
    const conversationId = '0b6a1d2e-7c1f-4f5e-9d8a-2b3c4d5e6f70';
    const turnId = '1b6a1d2e-7c1f-4f5e-9d8a-2b3c4d5e6f71';
    const token = chatFeedbackToken('project-1', conversationId, turnId);
    await submitSiteChatFeedback('project-1', { conversationId, turnId, token, rating, previousRating, consent: 'granted' });
    expect(recorded()).toEqual(name ? [expect.objectContaining({ name, rating, previousRating })] : []);
  });
});

describe('visitor consent rule', () => {
  it('requires consent only when a consent banner applies to configured scripts', () => {
    expect(aiChatConsentRequired({})).toBe(false);
    expect(aiChatConsentRequired({ analytics: { cookieConsent: true } })).toBe(true);
    expect(aiChatConsentRequired({ analytics: { cookieConsent: true, ga4: 'G-ABC123' } })).toBe(true);
    expect(aiChatConsentRequired({ addons: { consentBanner: { enabled: false } }, analytics: { ga4: 'G-ABC123' } })).toBe(false);
    expect(aiChatConsentRequired({ addons: { consentBanner: { enabled: true } }, analytics: { plausible: 'docs.example.com' } })).toBe(true);
  });

  it('does not let a client skip a consent banner that applies', () => {
    const banner = { analytics: { cookieConsent: true, ga4: 'G-ABC123' } };
    expect(trustedChatConsent(banner, 'not_required')).toBe('unknown');
    expect(trustedChatConsent(banner, 'granted')).toBe('granted');
    expect(trustedChatConsent({}, 'not_required')).toBe('not_required');
  });
});
