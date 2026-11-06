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
  recordTurn: vi.fn(),
  recordFeedback: vi.fn(),
  track: vi.fn(),
  condense: vi.fn(),
  stream: vi.fn(),
  suggest: vi.fn(),
  recordEvents: vi.fn(),
  adapter: vi.fn((runtime: { answerModel: string }) => ({ kind: runtime.answerModel })),
  extras: { SEARCH_CHAT_HISTORY_MESSAGES: 6, SEARCH_CHAT_HISTORY_MAX_TOKENS: 1500, SEARCH_CHAT_UTILITY_MODEL: undefined as string | undefined },
  request: { current: new Request('http://localhost/api/public/sites/p/chat', { method: 'POST' }) },
}));

vi.mock('@/env', () => ({ env: { SEARCH_ANSWER_MIN_CONFIDENCE: 0.2, BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-00' } }));
vi.mock('@/lib/env-extras', () => ({ envExtras: mocks.extras }));
vi.mock('hono/context-storage', () => ({ getContext: () => ({ req: { raw: mocks.request.current } }) }));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: vi.fn(async () => ({ organizationId: 'org-1' })) } } }));
vi.mock('./sites', () => ({ resolvePublishedAnswerContext: mocks.context, deviceFromUserAgent: () => 'desktop' }));
vi.mock('./analytics', () => ({ trackProjectEvent: mocks.track }));
vi.mock('@/lib/ai-search/runtime', () => ({ resolveChatRuntime: mocks.runtime, retrieveChatContext: mocks.retrieve }));
vi.mock('@/lib/ai-search/chat-budget', () => ({ reserveChatTurn: mocks.reserve, releaseChatTurn: mocks.release, settleChatSpend: mocks.settle }));
vi.mock('@/lib/ai-search/quota', () => ({ consumeAnswerQuota: mocks.quota }));
vi.mock('@/lib/ai-search/conversation-archive', () => ({
  recordAiChatTurn: mocks.recordTurn,
  recordAiChatFeedback: mocks.recordFeedback,
}));
vi.mock('./site-chat-events', () => ({ recordAiChatEvents: mocks.recordEvents }));
vi.mock('@nibleaf/search/workspace', () => ({ workspaceChatAdapter: mocks.adapter, workspaceChatModelOptions: () => () => ({}) }));
vi.mock('@nibleaf/search', () => ({
  CHAT_PROMPT_VERSION: 'chat-v3',
  CHAT_OUTPUT_TOKEN_LIMITS: { condense: 120, followUps: 200, answer: 1200 },
  boundChatHistory: (history: unknown[]) => history,
  estimateTokens: (text: string) => Math.ceil(text.length / 3),
  condenseFollowUp: mocks.condense,
  streamGroundedChat: mocks.stream,
  suggestFollowUps: mocks.suggest,
  citationsToSources: (citations: Array<Record<string, unknown>>) =>
    citations.map((citation) => ({ ...citation, snippet: 'snippet', direction: 'ltr' })),
  suggestedArticles: (chunks: Array<{ pageId: string; title: string; path: string }>) =>
    chunks
      .slice(0, 1)
      .map((chunk, index) => ({ id: `P${index + 1}`, pageId: chunk.pageId, title: chunk.title, path: chunk.path, snippet: 's', direction: 'ltr' })),
}));

import { aiChatConsentRequired, trustedChatConsent } from '@/lib/ai-search/chat-consent';
import { chatFeedbackToken } from '@/lib/ai-search/feedback-token';
import { chatSite, estimateChatTurnTokens, recordChatRateLimited, submitSiteChatFeedback } from './site-chat';

const chunk = {
  id: 'c1',
  pageId: 'page-1',
  title: 'Install',
  path: 'guides/install',
  content: 'Run the installer.',
  heading: 'With npm',
  direction: 'ltr',
};
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
const reservation = { allowed: true, turnIndex: 0, turnsRemaining: 19, reservedTokens: 9000, reservedAt: new Date('2026-11-06T10:00:00.000Z') };
/** Every content-free event recorded so far, in order. */
const recorded = () => mocks.recordEvents.mock.calls.flatMap(([, , events]) => events as Array<{ name: string } & Record<string, unknown>>);

describe('reader AI chat stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.current = new Request('http://localhost/api/public/sites/p/chat', { method: 'POST' });
    mocks.context.mockResolvedValue(context());
    mocks.runtime.mockResolvedValue({ providerId: 'openrouter', answerModel: 'openai/gpt-5.6-luna', answersEnabled: true });
    mocks.reserve.mockResolvedValue(reservation);
    mocks.quota.mockResolvedValue({ allowed: true, remaining: 41 });
    mocks.condense.mockResolvedValue({ query: 'How do I install it?', rewritten: false });
    mocks.retrieve.mockResolvedValue({ chunks: [chunk], hits: [{ chunk, score: 0.9 }], confidence: 0.8, cacheHit: false });
    mocks.suggest.mockResolvedValue({ questions: ['Can I install it offline?'], usage: { inputTokens: 30, outputTokens: 10 } });
    mocks.recordEvents.mockResolvedValue(undefined);
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = undefined;
    mocks.settle.mockResolvedValue(undefined);
    mocks.release.mockResolvedValue(undefined);
    mocks.recordTurn.mockResolvedValue(undefined);
    mocks.track.mockResolvedValue(undefined);
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
        model: 'openai/gpt-5.6-luna',
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
    // The citation links to the exact section, with the reader TOC's heading id.
    expect(final.citations[0]).toMatchObject({ heading: 'With npm', anchor: 'with-npm' });
    expect(aiChatFollowUpsEventSchema.parse(events.find((event) => event.name === AI_CHAT_EVENT.followUps)?.value)).toEqual({
      turnId: final.turnId,
      questions: ['Can I install it offline?'],
    });
    expect(final.feedbackToken).toBe(chatFeedbackToken('project-1', final.conversationId, final.turnId));
    // The page the reader asked from is passed as a narrowing hint only.
    expect(mocks.retrieve.mock.calls[0]?.[3]).toMatchObject({ page: { id: 'page-1', title: 'Install' } });
    await settle();
    // The turn reserved its estimate up front, then settles to what the answer and suggestion calls spent.
    expect(mocks.reserve).toHaveBeenCalledWith('project-1', final.conversationId, estimateChatTurnTokens(body()));
    expect(mocks.settle).toHaveBeenCalledWith('project-1', final.conversationId, reservation, 160);
    expect(recorded().map((event) => event.name)).toEqual(['question_asked', 'first_token', 'answer_completed']);
    expect(recorded()[0]).toMatchObject({ turnId: final.turnId, turnIndex: 0, followUp: false, pageContext: true });
    expect(recorded()[1]).toMatchObject({ ttftMs: expect.any(Number) });
    expect(recorded()[2]).toMatchObject({
      outcome: 'answered',
      provider: 'openrouter',
      model: 'openai/gpt-5.6-luna',
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

  it('never calls the model when retrieval is not confident and offers articles instead', async () => {
    mocks.retrieve.mockResolvedValue({ chunks: [chunk], hits: [{ chunk, score: 0.05 }], confidence: 0.05 });
    const events = await readEvents(await chatSite('project-1', body()));
    expect(mocks.stream).not.toHaveBeenCalled();
    const final = aiChatFinalEventSchema.parse(events.find((event) => event.name === AI_CHAT_EVENT.final)?.value);
    expect(final).toMatchObject({ status: 'no_answer', noAnswerReason: 'low_confidence', citations: [] });
    expect(final.suggestions).toHaveLength(1);
    expect(final.supportUrl).toBeUndefined();
    expect(events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')).toHaveLength(1);
    expect(mocks.suggest).not.toHaveBeenCalled();
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

  it('withholds suggestions after a declined answer and reports a failed suggestion call', async () => {
    mocks.suggest.mockResolvedValue({ questions: [], failed: true });
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
    await settle();
    expect(recorded()).toContainEqual(expect.objectContaining({ name: 'provider_error', phase: 'follow_ups' }));
  });

  it('routes rewriting and suggestions to the utility model on OpenRouter only', async () => {
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = 'openai/gpt-5.6-luna-mini';
    mocks.condense.mockResolvedValue({ query: 'install', rewritten: true, failed: true });
    mocks.stream.mockReturnValue({
      deltas: (async function* () {
        // The model declines without streaming any text.
      })(),
      result: Promise.resolve({
        status: 'no_answer',
        noAnswerReason: 'empty',
        answer: '',
        citations: [],
        droppedParagraphs: 0,
        model: 'm',
        latencyMs: 1,
      }),
    });
    await readEvents(await chatSite('project-1', body({ history: [{ role: 'user', content: 'npm' }] })));
    expect(mocks.condense.mock.calls[0]?.[0]).toMatchObject({ adapter: { kind: 'openai/gpt-5.6-luna-mini' } });
    expect(mocks.suggest.mock.calls[0]?.[0]).toMatchObject({ adapter: { kind: 'openai/gpt-5.6-luna-mini' } });
    expect(mocks.stream.mock.calls[0]?.[0]).toMatchObject({ adapter: { kind: 'openai/gpt-5.6-luna' } });
    await settle();
    expect(recorded()).toContainEqual(expect.objectContaining({ name: 'provider_error', phase: 'condense' }));
    expect(recorded()[0]).toMatchObject({ name: 'question_asked', followUp: true });

    mocks.adapter.mockClear();
    mocks.runtime.mockResolvedValue({ providerId: 'openai', answerModel: 'gpt-5.6-luna', answersEnabled: true });
    await readEvents(await chatSite('project-1', body()));
    expect(mocks.adapter).toHaveBeenCalledTimes(1);
  });

  it("records a separate utility model's usage and cost apart from the answer model's", async () => {
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = 'openai/gpt-5.6-luna-mini';
    // Each model's provider-reported cost lands in its own sink.
    mocks.adapter.mockImplementation((runtime: { answerModel: string }, sink?: { costUsd?: number }) => {
      if (sink) sink.costUsd = runtime.answerModel.endsWith('-mini') ? 0.0001 : 0.002;
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
        model: 'openai/gpt-5.6-luna',
      }),
    });
    await readEvents(await chatSite('project-1', body({ history: [{ role: 'user', content: 'npm' }] })));
    await settle();
    expect(mocks.recordTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-5.6-luna',
        inputTokens: 900,
        outputTokens: 120,
        costUsd: 0.002,
        utilityModel: 'openai/gpt-5.6-luna-mini',
        utilityInputTokens: 80,
        utilityOutputTokens: 20,
        utilityCostUsd: 0.0001,
      }),
    );
    // Budgets count both models; the event reports the model it names.
    expect(mocks.settle.mock.calls.at(-1)?.[3]).toBe(1120);
    expect(recorded().at(-1)).toMatchObject({ name: 'answer_completed', model: 'openai/gpt-5.6-luna', inputTokens: 900, costUsd: 0.002 });

    // Naming the answer model as the utility model is not a separate model.
    mocks.recordTurn.mockClear();
    mocks.extras.SEARCH_CHAT_UTILITY_MODEL = 'openai/gpt-5.6-luna';
    await readEvents(await chatSite('project-1', body({ history: [{ role: 'user', content: 'npm' }] })));
    await settle();
    expect(mocks.recordTurn.mock.calls.at(-1)?.[0]).not.toHaveProperty('utilityModel');
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
    mocks.suggest.mockReturnValue(new Promise(() => undefined));
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
    const spent = mocks.settle.mock.calls.at(-1)?.[3] as number;
    expect(spent).toBeGreaterThan(3600);
    expect(spent).toBe(Number(turn.inputTokens) + Number(turn.outputTokens));
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
        model: 'openai/gpt-5.6-luna',
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
    expect(mocks.retrieve.mock.calls[0]?.[3]).toMatchObject({ page: undefined });
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
    expect(aiChatConsentRequired({ analytics: { cookieConsent: true } })).toBe(false);
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
