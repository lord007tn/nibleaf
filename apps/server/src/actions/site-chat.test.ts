import { AI_CHAT_EVENT, aiChatFinalEventSchema, type SiteChatBody } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  runtime: vi.fn(),
  retrieve: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  spend: vi.fn(),
  quota: vi.fn(),
  recordTurn: vi.fn(),
  recordFeedback: vi.fn(),
  track: vi.fn(),
  condense: vi.fn(),
  stream: vi.fn(),
  request: { current: new Request('http://localhost/api/public/sites/p/chat', { method: 'POST' }) },
}));

vi.mock('@/env', () => ({ env: { SEARCH_ANSWER_MIN_CONFIDENCE: 0.2, BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-00' } }));
vi.mock('@/lib/env-extras', () => ({
  envExtras: { SEARCH_CHAT_HISTORY_MESSAGES: 6, SEARCH_CHAT_HISTORY_MAX_TOKENS: 1500 },
}));
vi.mock('hono/context-storage', () => ({ getContext: () => ({ req: { raw: mocks.request.current } }) }));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: vi.fn(async () => ({ organizationId: 'org-1' })) } } }));
vi.mock('./sites', () => ({ resolvePublishedAnswerContext: mocks.context, deviceFromUserAgent: () => 'desktop' }));
vi.mock('./analytics', () => ({ trackProjectEvent: mocks.track }));
vi.mock('@/lib/ai-search/runtime', () => ({ resolveChatRuntime: mocks.runtime, retrieveChatContext: mocks.retrieve }));
vi.mock('@/lib/ai-search/chat-budget', () => ({ reserveChatTurn: mocks.reserve, releaseChatTurn: mocks.release, recordChatSpend: mocks.spend }));
vi.mock('@/lib/ai-search/quota', () => ({ consumeAnswerQuota: mocks.quota }));
vi.mock('@/lib/ai-search/conversation-archive', () => ({ recordAiChatTurn: mocks.recordTurn, recordAiChatFeedback: mocks.recordFeedback }));
vi.mock('@nibleaf/search/workspace', () => ({ workspaceChatAdapter: () => ({ kind: 'fake-adapter' }), workspaceChatModelOptions: () => () => ({}) }));
vi.mock('@nibleaf/search', () => ({
  CHAT_PROMPT_VERSION: 'chat-v1',
  boundChatHistory: (history: unknown[]) => history,
  estimateTokens: (text: string) => Math.ceil(text.length / 3),
  condenseFollowUp: mocks.condense,
  streamGroundedChat: mocks.stream,
  citationsToSources: (citations: Array<Record<string, unknown>>) =>
    citations.map((citation) => ({ ...citation, snippet: 'snippet', direction: 'ltr' })),
  suggestedArticles: (chunks: Array<{ pageId: string; title: string; path: string }>) =>
    chunks
      .slice(0, 1)
      .map((chunk, index) => ({ id: `P${index + 1}`, pageId: chunk.pageId, title: chunk.title, path: chunk.path, snippet: 's', direction: 'ltr' })),
}));

import { chatFeedbackToken } from '@/lib/ai-search/feedback-token';
import { aiChatConsentRequired, chatSite, submitSiteChatFeedback } from './site-chat';

const chunk = { id: 'c1', pageId: 'page-1', title: 'Install', path: 'guides/install', content: 'Run the installer.', heading: '', direction: 'ltr' };
const context = (overrides: Record<string, unknown> = {}) => ({
  snapshot: { project: { config: {}, languages: [{ code: 'en', isDefault: true, enabled: true }] } },
  deploymentId: 'deploy-1',
  request: { configuration: { aiConversationCapture: true } },
  scope: { projectId: 'project-1', deploymentId: 'deploy-1', versionSlug: 'v1', language: 'en', visibility: 'public', allowedPageIds: null },
  available: true,
  versionPages: [{ id: 'page-1', kind: 'PAGE', hidden: false, languageCode: 'en', path: 'guides/install', title: 'Install' }],
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

describe('reader AI chat stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.current = new Request('http://localhost/api/public/sites/p/chat', { method: 'POST' });
    mocks.context.mockResolvedValue(context());
    mocks.runtime.mockResolvedValue({ providerId: 'openrouter', answerModel: 'openai/gpt-5.6-luna', answersEnabled: true });
    mocks.reserve.mockResolvedValue({ allowed: true, turnIndex: 0, turnsRemaining: 19 });
    mocks.quota.mockResolvedValue({ allowed: true, remaining: 41 });
    mocks.condense.mockResolvedValue({ query: 'How do I install it?', rewritten: false });
    mocks.retrieve.mockResolvedValue({ chunks: [chunk], hits: [{ chunk, score: 0.9 }], confidence: 0.8 });
    mocks.spend.mockResolvedValue(undefined);
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
        citations: [{ id: 'S1', pageId: 'page-1', title: 'Install', path: 'guides/install' }],
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
      'RUN_FINISHED',
    ]);
    const final = aiChatFinalEventSchema.parse(events.find((event) => event.name === AI_CHAT_EVENT.final)?.value);
    expect(final).toMatchObject({ status: 'answered', answer: 'Run the installer. [S1]', limits: { turnsRemaining: 19, quotaRemaining: 41 } });
    expect(final.feedbackToken).toBe(chatFeedbackToken('project-1', final.conversationId, final.turnId));
    // The page the reader asked from is passed as a narrowing hint only.
    expect(mocks.retrieve.mock.calls[0]?.[3]).toMatchObject({ page: { id: 'page-1', title: 'Install' } });
    await settle();
    expect(mocks.spend).toHaveBeenCalledWith('project-1', final.conversationId, 120);
    expect(mocks.recordTurn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1', status: 'answered', turnId: final.turnId, pagePath: 'guides/install', inputTokens: 100 }),
    );
    expect(mocks.track).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ name: 'answer_completed', promptTokens: 100 }),
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
    expect(events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')).toHaveLength(1);
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
  });

  it('releases the reserved turn when the daily quota refuses it', async () => {
    mocks.quota.mockResolvedValue({ allowed: false, remaining: 0 });
    await readEvents(await chatSite('project-1', body()));
    expect(mocks.release).toHaveBeenCalledWith('project-1', '0b6a1d2e-7c1f-4f5e-9d8a-2b3c4d5e6f70');
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
});
