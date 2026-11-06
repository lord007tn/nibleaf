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
window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);

import Panel from './panel';

const text = (id: string, role: Message['role'], content: string): Message => ({ id, role, parts: [{ type: 'text', content }] });
const roots: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of roots.splice(0)) await unmount();
  document.body.replaceChildren();
  vi.clearAllMocks();
});
const render = async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(() => act(async () => root.unmount()));
  await act(async () =>
    root.render(<Panel projectId="docs" lang="en" direction="ltr" config={null} open onOpenChange={vi.fn()} requiresConsent={false} />),
  );
};

describe('chat panel', () => {
  it('never shows the unchecked text of a stopped answer, and asks again in its place', async () => {
    mocks.chat.messages = [text('u1', 'user', 'How do I export one notebook?'), text('a1', 'assistant', 'Run acme export [S6]\n\nOpen a')];
    await render();
    expect(document.body.textContent).toContain('You stopped this answer before it was finished.');
    expect(document.body.textContent).not.toContain('Run acme export');
    const retry = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Retry');
    await act(async () => retry?.click());
    // The stopped exchange is replaced, not repeated.
    expect(mocks.chat.setMessages).toHaveBeenCalledWith([]);
    expect(mocks.chat.sendMessage).toHaveBeenCalledWith('How do I export one notebook?', expect.anything());
  });

  it('keeps an earlier answered exchange when asking an older stopped question again', async () => {
    mocks.chat.messages = [
      text('u1', 'user', 'First question?'),
      text('a1', 'assistant', 'Half an answer'),
      text('u2', 'user', 'Second question?'),
      text('a2', 'assistant', 'Another half'),
    ];
    await render();
    const retries = [...document.querySelectorAll('button')].filter((button) => button.textContent === 'Retry');
    expect(retries).toHaveLength(2);
    await act(async () => retries[0]?.click());
    // Not the last exchange: asked again as a new question.
    expect(mocks.chat.setMessages).not.toHaveBeenCalled();
    expect(mocks.chat.sendMessage).toHaveBeenCalledWith('First question?', expect.anything());
  });

  it('streams without citation markers', async () => {
    mocks.chat.isLoading = true;
    mocks.chat.messages = [text('u1', 'user', 'How?'), text('a1', 'assistant', 'Run acme export. [S6]')];
    await render();
    expect(document.body.textContent).toContain('Run acme export.');
    expect(document.body.textContent).not.toContain('[S6]');
    mocks.chat.isLoading = false;
  });
});
