// @vitest-environment jsdom

import type { AiChatFinalEvent } from '@nibleaf/validators';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ChatMessage } from './message';

vi.mock('@/functions/site-chat', () => ({ submitChatFeedbackFn: vi.fn() }));
const options = { projectId: 'project', lang: 'en', direction: 'ltr' as const, config: null };
const final: AiChatFinalEvent = {
  conversationId: '00000000-0000-4000-8000-000000000001',
  turnId: '00000000-0000-4000-8000-000000000002',
  status: 'answered',
  answer: 'Verified answer [S1]',
  citations: [{ id: 'S1', pageId: 'page', title: 'Getting started', path: 'guide', snippet: 'Useful steps', direction: 'ltr' }],
  suggestions: [],
  feedbackToken: '1234567890123456',
  language: 'en',
  limits: { turnsRemaining: 10, quotaRemaining: 10 },
};
describe('reader chat messages', () => {
  it('replaces a streamed draft and turns citations into focusable chips', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const render = (payload?: AiChatFinalEvent) => (
      <ChatMessage text="Unverified draft" final={payload} options={options} busy={!payload} consent="not_required" close={vi.fn()} />
    );
    await act(async () => root.render(render()));
    expect(container.textContent).toContain('Unverified draft');
    await act(async () => root.render(render(final)));
    expect(container.textContent).toContain('Verified answer');
    expect(container.textContent).not.toContain('Unverified draft');
    const chip = container.querySelector<HTMLButtonElement>('button[aria-label="Source 1"]');
    expect(chip).not.toBeNull();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    chip?.click();
    expect(document.activeElement?.textContent).toContain('Getting started');
    await act(async () => root.unmount());
    container.remove();
  });
  it('shows calm no-answer copy and suggested articles, with model HTML and links inert', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <ChatMessage
          text="draft"
          final={{ ...final, status: 'no_answer', answer: 'ignored', citations: [], suggestions: final.citations }}
          options={options}
          busy={false}
          consent="unknown"
          close={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain("couldn't verify");
    expect(container.textContent).toContain('These articles might help');
    expect(container.querySelector('a')?.getAttribute('href')).toContain('guide');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () =>
      root.render(
        <ChatMessage
          text=""
          final={{ ...final, status: 'no_answer' }}
          options={{ ...options, lang: 'ar', direction: 'rtl' }}
          busy={false}
          consent="unknown"
          close={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain('لم أجد في الوثائق ما يؤكد الإجابة');
    await act(async () =>
      root.render(
        <ChatMessage
          text={'[bad](https://evil.test) <img src=x onerror=alert(1) />'}
          options={options}
          busy={true}
          consent="unknown"
          close={vi.fn()}
        />,
      ),
    );
    expect(container.querySelector('a, img, script')).toBeNull();
    await act(async () => root.unmount());
  });
});
