// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Message = { id: string; role: 'user' | 'assistant'; parts: Array<{ type: 'text'; content: string }> };
const mocks = vi.hoisted(() => ({
  postEvents: vi.fn(async () => undefined),
  // The live capture policy (GET …/chat/policy); by default the same as the shell's.
  fetchPolicy: vi.fn(),
  // The options the panel gave useChat, to deliver its custom events.
  options: undefined as undefined | { onCustomEvent: (name: string, value: unknown) => void },
  chat: {
    messages: [] as Message[],
    isLoading: false,
    error: undefined as Error | undefined,
    stop: vi.fn(),
    clear: vi.fn(),
    sendMessage: vi.fn(async () => undefined),
    setMessages: vi.fn(),
  },
}));
vi.mock('@tanstack/ai-react', () => ({
  useChat: (options: typeof mocks.options) => {
    mocks.options = options;
    return mocks.chat;
  },
}));
vi.mock('@/services/api', () => ({ api: { public: { sites: { ':id': { chat: { events: { $post: mocks.postEvents } } } } } } }));
vi.mock('@/functions/site-chat', () => ({ chatSiteFn: vi.fn(), trackChatEventsFn: vi.fn(async () => undefined) }));
vi.mock('./policy', () => ({ fetchChatPolicy: mocks.fetchPolicy }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
Element.prototype.scrollIntoView = vi.fn();
const desktop = () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList;
window.matchMedia = vi.fn(desktop);
/** A phone: touch and narrow media queries match for the rest of the test. */
const phone = () =>
  vi.mocked(window.matchMedia).mockImplementation(
    (query) =>
      ({
        matches: /pointer: coarse|max-width: 767px/.test(query),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );

import { writeSiteConsent } from '@/lib/site-consent';
import Panel from './panel';

const text = (id: string, role: Message['role'], content: string): Message => ({ id, role, parts: [{ type: 'text', content }] });
const roots: Array<() => Promise<void>> = [];
// The docs version on screen; a test switches it between renders.
let siteVersion: string | undefined;
let requiresConsent = false;
let projectId = 'docs';
// Days the server keeps question text for the site; null when it keeps none.
let questionRetentionDays: number | null = null;
/** A live policy, with a revision of its own. */
const policyOf = (days: number | null, consent: 'required' | 'not_required' = requiresConsent ? 'required' : 'not_required') => ({
  storesQuestions: days !== null,
  questionRetentionDays: days,
  consent,
  revision: `rev-${days}-${consent}`,
});
const shellPolicy = async () => policyOf(questionRetentionDays);
beforeEach(() => {
  mocks.fetchPolicy.mockImplementation(shellPolicy);
});
afterEach(async () => {
  for (const unmount of roots.splice(0)) await unmount();
  document.body.replaceChildren();
  mocks.chat.isLoading = false;
  siteVersion = undefined;
  requiresConsent = false;
  projectId = 'docs';
  questionRetentionDays = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  vi.mocked(window.matchMedia).mockImplementation(desktop);
});
const mount = async (request?: { id: number; question?: string; source: 'deep_link' | 'search_handoff' }) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  roots.push(() => act(async () => root.unmount()));
  const render = (open = true) =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Panel
            projectId={projectId}
            lang="en"
            version={siteVersion}
            direction="ltr"
            config={null}
            questionRetentionDays={questionRetentionDays}
            open={open}
            onOpenChange={vi.fn()}
            requiresConsent={requiresConsent}
            request={request}
          />
        </QueryClientProvider>,
      ),
    );
  await render();
  return render;
};
const button = (label: string) => [...document.querySelectorAll('button')].filter((candidate) => candidate.textContent === label);
const stopAndSettle = async (render: () => Promise<void>) => {
  await act(async () => button('Stop generating')[0]?.click());
  mocks.chat.isLoading = false;
  await render();
};

const ANSWER_ID = '7c1d0b6e-2f4a-4c8e-9b1d-3e5f6a7b8c9d';
/** Sends a starter question and returns the conversation id the panel used. */
const askStarter = async () => {
  await act(async () => button('How do I get started?')[0]?.click());
  const call = mocks.chat.sendMessage.mock.calls.at(-1) as unknown as [string, { body: { conversationId: string } }];
  return { question: call[0], conversationId: call[1].body.conversationId };
};
const deliver = (name: string, value: unknown) => act(async () => mocks.options?.onCustomEvent(name, value));
const finalFor = (conversationId: string) => ({
  conversationId,
  turnId: ANSWER_ID,
  status: 'answered',
  answer: 'Run the installer. [S1]',
  citations: [],
  suggestions: [],
  feedbackToken: 'token-token-token-token',
  language: 'en',
  limits: { turnsRemaining: 18, quotaRemaining: 40 },
});

describe('chat panel', () => {
  it('ends the wait at the checked answer, shows suggestions that arrive after it, and lets a new question through', async () => {
    mocks.chat.messages = [];
    const render = await mount();
    const { question, conversationId } = await askStarter();
    mocks.chat.isLoading = true;
    mocks.chat.messages = [text('u1', 'user', question), text(ANSWER_ID, 'assistant', 'Run the installer. [S1]')];
    await render();
    expect(button('Stop generating')).toHaveLength(1);
    await deliver('nibleaf.chat.final', finalFor(conversationId));
    await render();
    // Still loading suggestions, but the answer is done: no Stop, no progress line.
    expect(button('Stop generating')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Checking');
    await deliver('nibleaf.chat.followups', { turnId: ANSWER_ID, questions: ['Can I install it offline?'] });
    await render();
    await act(async () => button('Can I install it offline?')[0]?.click());
    // The next question interrupts the suggestions still loading.
    expect(mocks.chat.sendMessage).toHaveBeenLastCalledWith('Can I install it offline?', expect.objectContaining({ whenBusy: 'interrupt' }));
  });

  it('puts the refused question in a new chat, to edit before sending, after the conversation limit', async () => {
    mocks.chat.messages = [];
    const render = await mount();
    const { question, conversationId } = await askStarter();
    mocks.chat.messages = [text('u1', 'user', question)];
    await deliver('nibleaf.chat.error', { code: 'conversation_limit' });
    await render();
    // The notice's button, not the header's plain "New chat".
    expect(button('New chat')).toHaveLength(2);
    await act(async () => button('New chat').at(-1)?.click());
    expect(mocks.chat.clear).toHaveBeenCalledOnce();
    // Not sent on its own: it may refer to the conversation the new chat lacks.
    expect(mocks.chat.sendMessage).toHaveBeenCalledOnce();
    const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your question"]');
    expect(field?.value).toBe(question);
    expect(document.activeElement).toBe(field);
    await act(async () => button('Send')[0]?.click());
    const [again, options] = mocks.chat.sendMessage.mock.calls.at(-1) as unknown as [string, { body: { conversationId: string } }];
    expect(again).toBe(question);
    expect(options.body.conversationId).not.toBe(conversationId);
    // Closing and reopening the panel never brings the sent question back.
    await render(false);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    await render(true);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your question"]')?.value).toBe('');
    // Reopening shows the latest exchange.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('fills the field from a shared ?ask= link and waits for the reader to send it', async () => {
    mocks.chat.messages = [];
    await mount({ id: 1, question: 'What is the support number?', source: 'deep_link' });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your question"]');
    expect(field?.value).toBe('What is the support number?');
    expect(document.activeElement).toBe(field);
    await act(async () => button('Send')[0]?.click());
    expect(mocks.chat.sendMessage).toHaveBeenCalledOnce();
    expect((mocks.chat.sendMessage.mock.calls as unknown as string[][])[0]?.[0]).toBe('What is the support number?');
  });

  it('does not open a phone keyboard over a shared question', async () => {
    mocks.chat.messages = [];
    phone();
    await mount({ id: 1, question: 'What is the support number?', source: 'deep_link' });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your question"]');
    expect(field?.value).toBe('What is the support number?');
    expect(document.activeElement).not.toBe(field);
  });

  it('fills the field from a shared link even while an answer is still being written', async () => {
    mocks.chat.messages = [text('u1', 'user', 'Earlier question')];
    mocks.chat.isLoading = true;
    await mount({ id: 1, question: 'What is the support number?', source: 'deep_link' });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your question"]')?.value).toBe('What is the support number?');
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
  });

  it('still sends a question handed over from search at once', async () => {
    mocks.chat.messages = [];
    await mount({ id: 1, question: 'How do I export?', source: 'search_handoff' });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect((mocks.chat.sendMessage.mock.calls as unknown as string[][])[0]?.[0]).toBe('How do I export?');
  });

  it('keeps what the reader typed when the panel closes before it is sent', async () => {
    mocks.chat.messages = [];
    const render = await mount();
    const textarea = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your question"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(textarea(), 'How do I export only');
      textarea()?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await render(false);
    expect(textarea()).toBeNull();
    await render(true);
    expect(textarea()?.value).toBe('How do I export only');
  });

  it('announces suggestions that arrive after the answer, and keeps the reading position', async () => {
    mocks.chat.messages = [];
    const render = await mount();
    const { question, conversationId } = await askStarter();
    mocks.chat.isLoading = true;
    mocks.chat.messages = [text('u1', 'user', question), text(ANSWER_ID, 'assistant', 'Run the installer. [S1]')];
    await render();
    await deliver('nibleaf.chat.final', finalFor(conversationId));
    // The reader scrolls up to reread the answer.
    const log = document.querySelector<HTMLElement>('[role="log"]');
    if (!log) throw new Error('expected the message log');
    Object.defineProperties(log, { scrollHeight: { value: 2000 }, clientHeight: { value: 400 }, scrollTop: { value: 100, writable: true } });
    await act(async () => log.dispatchEvent(new Event('scroll')));
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    await deliver('nibleaf.chat.followups', { turnId: ANSWER_ID, questions: ['Can I install it offline?'] });
    await render();
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Suggested next questions added.');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    // Back at the bottom, new content is followed again.
    log.scrollTop = 1600;
    await act(async () => log.dispatchEvent(new Event('scroll')));
    await deliver('nibleaf.chat.followups', { turnId: ANSWER_ID, questions: ['Can I install it offline?', 'Is there a CLI?'] });
    await render();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it.each([
    ['before any answer exists', [text('u1', 'user', 'How do I export one notebook?')]],
    ['with an empty answer shell', [text('u1', 'user', 'How do I export one notebook?'), text('a1', 'assistant', '')]],
    [
      'mid-answer, never showing its unchecked text',
      [text('u1', 'user', 'How do I export one notebook?'), text('a1', 'assistant', 'Run acme export [S6]\n\nOpen a')],
    ],
  ])('notes a question stopped %s, and asks it again in its place', async (_, messages) => {
    mocks.chat.isLoading = true;
    mocks.chat.messages = messages;
    const render = await mount();
    await stopAndSettle(render);
    expect(mocks.chat.stop).toHaveBeenCalledOnce();
    // Focus stays in the dialog, on the question field.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Your question');
    expect(document.body.textContent).toContain('You stopped this answer before it was finished.');
    expect(document.body.textContent).not.toContain('Run acme export');
    await act(async () => button('Retry')[0]?.click());
    // The stopped exchange is replaced, not repeated.
    expect(mocks.chat.setMessages).toHaveBeenCalledWith([]);
    expect(mocks.chat.sendMessage).toHaveBeenCalledWith('How do I export one notebook?', expect.anything());
  });

  it('keeps an earlier exchange when asking an older stopped question again', async () => {
    mocks.chat.isLoading = true;
    mocks.chat.messages = [text('u1', 'user', 'First question?'), text('a1', 'assistant', 'Half an answer')];
    const render = await mount();
    await stopAndSettle(render);
    mocks.chat.messages = [...mocks.chat.messages, text('u2', 'user', 'Second question?'), text('a2', 'assistant', 'Another half')];
    await render();
    await act(async () => button('Retry')[0]?.click());
    // Not the last exchange: asked again as a new question.
    expect(mocks.chat.setMessages).not.toHaveBeenCalled();
    expect(mocks.chat.sendMessage).toHaveBeenCalledWith('First question?', expect.anything());
  });

  it('never shows the unchecked text of an answer that broke off, and stays quiet for a refused one', async () => {
    mocks.chat.messages = [
      text('u1', 'user', 'First?'),
      text('a1', 'assistant', 'Partial text [S2]'),
      text('u2', 'user', 'Second?'),
      text('a2', 'assistant', ''),
    ];
    await mount();
    expect(document.body.textContent).not.toContain('Partial text');
    expect(document.body.textContent).toContain('Something went wrong. Please try again.');
    expect(document.body.textContent).not.toContain('You stopped this answer');
  });

  it.each([
    ['the default version', undefined, 'v2'],
    ['a named version', 'v2', undefined],
  ])('keeps the links of an answer given on %s after the reader switches version', async (_, asked, switched) => {
    siteVersion = asked;
    mocks.chat.messages = [];
    const render = await mount();
    const { question, conversationId } = await askStarter();
    mocks.chat.messages = [text('u1', 'user', question), text(ANSWER_ID, 'assistant', 'Run the installer. [S1]')];
    const source = {
      id: 'S1',
      pageId: 'page',
      title: 'Install',
      path: 'guide',
      heading: 'Install',
      anchor: 'install',
      snippet: 'Run the installer',
      direction: 'ltr',
    };
    await deliver('nibleaf.chat.final', { ...finalFor(conversationId), citations: [source] });
    siteVersion = switched;
    await render();
    const link = document.getElementById(`${ANSWER_ID}-source-1`)?.getAttribute('href');
    // jsdom's host reads as a custom domain: no /sites/<id> prefix.
    expect(link).toBe(`/${asked ? `${asked}/` : ''}guide?lang=en#install`);
  });

  it('streams without citation markers, even one split across chunks', async () => {
    mocks.chat.isLoading = true;
    mocks.chat.messages = [text('u1', 'user', 'How?'), text('a1', 'assistant', 'Run acme export. [S6] Then [S')];
    await mount();
    expect(document.body.textContent).toContain('Run acme export. Then');
    expect(document.body.textContent).not.toMatch(/\[S/);
  });
});

it('omits identity until consent allows it, and scopes approved sessions by project', async () => {
  mocks.chat.messages = [];
  requiresConsent = true;
  const render = await mount();
  await askStarter();
  expect((mocks.chat.sendMessage.mock.calls.at(-1) as unknown as [string, { body: Record<string, unknown> }])?.[1]?.body).toMatchObject({
    consent: 'unknown',
    sessionId: undefined,
  });
  expect(window.sessionStorage.length).toBe(0);
  window.localStorage.setItem('nibleaf.analytics.consent.docs', 'declined');
  await askStarter();
  expect((mocks.chat.sendMessage.mock.calls.at(-1) as unknown as [string, { body: Record<string, unknown> }])?.[1]?.body).toMatchObject({
    consent: 'denied',
    sessionId: undefined,
  });
  expect(window.sessionStorage.length).toBe(0);
  window.localStorage.setItem('nibleaf.analytics.consent.docs', 'accepted');
  await askStarter();
  const first = window.sessionStorage.getItem('nibleaf.chat.session.docs');
  expect(first).toBeTruthy();
  expect((mocks.chat.sendMessage.mock.calls.at(-1) as unknown as [string, { body: Record<string, unknown> }])?.[1]?.body).toMatchObject({
    consent: 'granted',
    sessionId: first,
  });
  projectId = 'another-project';
  requiresConsent = false;
  await render();
  await askStarter();
  expect(window.sessionStorage.getItem('nibleaf.chat.session.another-project')).not.toBe(first);
});

it('flushes capture-time consent through the authenticated keepalive endpoint on pagehide', async () => {
  mocks.chat.messages = [];
  requiresConsent = true;
  await mount({ id: 901, source: 'search_handoff' });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  await act(async () => window.dispatchEvent(new Event('pagehide')));
  expect(mocks.postEvents).toHaveBeenCalledWith(
    { param: { id: 'docs' }, json: expect.objectContaining({ consent: 'unknown', events: [expect.objectContaining({ name: 'chat_opened' })] }) },
    { init: { keepalive: true } },
  );
});

describe('what the panel says about saving questions', () => {
  const saved = () => [...document.querySelectorAll('footer p')].find((line) => line.textContent?.startsWith('Questions are'));
  it('says nothing about saving when the server keeps no question text', async () => {
    mocks.chat.messages = [];
    await mount();
    expect(document.querySelector('footer')?.textContent).toContain('AI can make mistakes');
    expect(saved()).toBeUndefined();
    expect(document.body.textContent).not.toMatch(/saved|kept for/i);
  });

  it('gives the real retention period when the server keeps questions', async () => {
    mocks.chat.messages = [];
    questionRetentionDays = 30;
    await mount();
    expect(saved()?.textContent).toBe("Questions are kept for 30 days to help improve these docs. Please don't include personal details.");
  });

  it('follows the reader consent the server applies before it keeps anything', async () => {
    mocks.chat.messages = [];
    questionRetentionDays = 90;
    requiresConsent = true;
    const render = await mount();
    expect(saved()).toBeUndefined();
    window.localStorage.setItem('nibleaf.analytics.consent.docs', 'declined');
    await render();
    expect(saved()).toBeUndefined();
    window.localStorage.setItem('nibleaf.analytics.consent.docs', 'accepted');
    await render();
    expect(saved()?.textContent).toContain('kept for 90 days');
  });

  it('follows a consent choice made in another tab, without a rerender', async () => {
    mocks.chat.messages = [];
    questionRetentionDays = 90;
    requiresConsent = true;
    await mount();
    expect(saved()).toBeUndefined();
    await act(async () => {
      window.localStorage.setItem('nibleaf.analytics.consent.docs', 'accepted');
      window.dispatchEvent(new StorageEvent('storage', { key: 'nibleaf.analytics.consent.docs', newValue: 'accepted' }));
    });
    expect(saved()?.textContent).toContain('kept for 90 days');
    // Another site's choice changes nothing here.
    await act(async () => {
      window.localStorage.setItem('nibleaf.analytics.consent.docs', 'declined');
      window.dispatchEvent(new StorageEvent('storage', { key: 'nibleaf.analytics.consent.other', newValue: 'declined' }));
    });
    expect(saved()?.textContent).toContain('kept for 90 days');
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'nibleaf.analytics.consent.docs', newValue: 'declined' })));
    expect(saved()).toBeUndefined();
  });

  it("follows the consent banner's choice in this tab, without a rerender", async () => {
    mocks.chat.messages = [];
    questionRetentionDays = 90;
    requiresConsent = true;
    await mount();
    expect(saved()).toBeUndefined();
    await act(async () => writeSiteConsent('docs', 'accepted'));
    expect(saved()?.textContent).toContain('kept for 90 days');
  });

  it('describes the panel plainly in its header', async () => {
    mocks.chat.messages = [];
    await mount();
    expect(document.querySelector('header')?.textContent).toContain('Answers use these docs and link to their sources.');
  });
});

describe('a reader whose page stayed open while the capture policy changed', () => {
  const saved = () => [...document.querySelectorAll('footer p')].find((line) => line.textContent?.startsWith('Questions are'));
  const notice = 'How this chat handles questions changed while this page was open. Check the notes below, then send your question again.';
  const sentRevision = () =>
    (mocks.chat.sendMessage.mock.calls.at(-1) as unknown as [string, { body: { policyRevision?: string } }])[1].body.policyRevision;
  /** A policy request that answers when the test says so. */
  const pending = () => {
    let answer: (policy: ReturnType<typeof policyOf>) => void = () => undefined;
    mocks.fetchPolicy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    return (policy: ReturnType<typeof policyOf>) => act(async () => answer(policy));
  };

  it('fetches the live policy when the panel opens, never from a cache', async () => {
    mocks.chat.messages = [];
    await mount();
    expect(mocks.fetchPolicy).toHaveBeenCalledWith('docs', 'en', undefined);
  });

  it.each([
    ['turned on', null, 90],
    ['turned off', 90, null],
  ] as const)('shows the live terms when capture was %s after the page loaded', async (_change, shell, live) => {
    mocks.chat.messages = [];
    questionRetentionDays = shell;
    mocks.fetchPolicy.mockImplementation(async () => policyOf(live));
    await mount();
    if (live === null) expect(saved()).toBeUndefined();
    else expect(saved()?.textContent).toContain(`kept for ${live} days`);
    await askStarter();
    expect(sentRevision()).toBe(policyOf(live).revision);
  });

  it.each([
    ['turned on', null, 90],
    ['turned off', 90, null],
  ] as const)('holds a first question sent before the live terms arrived, when capture was %s', async (_change, shell, live) => {
    mocks.chat.messages = [];
    questionRetentionDays = shell;
    const arrive = pending();
    await mount();
    await act(async () => button('How do I get started?')[0]?.click());
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    await arrive(policyOf(live));
    // Not sent under terms the reader wasn't shown: the new terms are on screen.
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(notice);
    if (live === null) expect(saved()).toBeUndefined();
    else expect(saved()?.textContent).toContain(`kept for ${live} days`);
    // The reader sends it again themselves, under the terms now shown.
    await act(async () => button('Retry')[0]?.click());
    expect(mocks.chat.sendMessage).toHaveBeenCalledOnce();
    expect(sentRevision()).toBe(policyOf(live).revision);
  });

  it('sends a first question at once when the live terms say what the panel already showed', async () => {
    mocks.chat.messages = [];
    questionRetentionDays = 90;
    const arrive = pending();
    await mount();
    await act(async () => button('How do I get started?')[0]?.click());
    await arrive(policyOf(90));
    expect(mocks.chat.sendMessage).toHaveBeenCalledOnce();
    expect(sentRevision()).toBe(policyOf(90).revision);
  });

  it.each([
    ['turned on', null, 90],
    ['turned off', 90, null],
  ] as const)('shows the new terms and waits for the reader when the server refuses a turn after capture was %s', async (_change, before, after) => {
    mocks.chat.messages = [];
    questionRetentionDays = before;
    const render = await mount();
    const { question } = await askStarter();
    expect(sentRevision()).toBe(policyOf(before).revision);
    // Changed on the server while the panel was open.
    mocks.fetchPolicy.mockImplementation(async () => policyOf(after));
    mocks.chat.messages = [text('u1', 'user', question), text('a1', 'assistant', '')];
    await deliver('nibleaf.chat.error', { code: 'policy_changed' });
    await render();
    expect(document.body.textContent).toContain(notice);
    if (after === null) expect(saved()).toBeUndefined();
    else expect(saved()?.textContent).toContain(`kept for ${after} days`);
    // Nothing is sent again on the reader's behalf.
    expect(mocks.chat.sendMessage).toHaveBeenCalledOnce();
    await act(async () => button('Retry')[0]?.click());
    expect(mocks.chat.sendMessage).toHaveBeenCalledTimes(2);
    expect(sentRevision()).toBe(policyOf(after).revision);
  });

  it('keeps the question when the live terms cannot be fetched', async () => {
    mocks.chat.messages = [];
    mocks.fetchPolicy.mockRejectedValue(new Error('offline'));
    await mount();
    const field = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your question"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field(), 'How do I export?');
      field()?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Send')[0]?.click());
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    expect(field()?.value).toBe('How do I export?');
  });
});
