// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Message = { id: string; role: 'user' | 'assistant'; parts: Array<{ type: 'text'; content: string }> };
const mocks = vi.hoisted(() => ({
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
vi.mock('@tanstack/ai-react', () => ({ useChat: () => mocks.chat }));
vi.mock('@/functions/site-chat', () => ({ chatSiteFn: vi.fn(), trackChatEventsFn: vi.fn(async () => undefined) }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
Element.prototype.scrollIntoView = vi.fn();
window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);

import Panel from './panel';

const text = (id: string, role: Message['role'], content: string): Message => ({ id, role, parts: [{ type: 'text', content }] });
const roots: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of roots.splice(0)) await unmount();
  document.body.replaceChildren();
  mocks.chat.isLoading = false;
  vi.clearAllMocks();
});
const mount = async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(() => act(async () => root.unmount()));
  const render = () =>
    act(async () =>
      root.render(<Panel projectId="docs" lang="en" direction="ltr" config={null} open onOpenChange={vi.fn()} requiresConsent={false} />),
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

describe('chat panel', () => {
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

  it('streams without citation markers, even one split across chunks', async () => {
    mocks.chat.isLoading = true;
    mocks.chat.messages = [text('u1', 'user', 'How?'), text('a1', 'assistant', 'Run acme export. [S6] Then [S')];
    await mount();
    expect(document.body.textContent).toContain('Run acme export. Then');
    expect(document.body.textContent).not.toMatch(/\[S/);
  });
});
