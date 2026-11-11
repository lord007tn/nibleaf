// @vitest-environment jsdom

import type { AiChatFinalEvent } from '@nibleaf/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ChatMessage } from './message';

const mocks = vi.hoisted(() => ({ feedback: vi.fn() }));
vi.mock('@/functions/site-chat', () => ({ submitChatFeedbackFn: mocks.feedback }));
const options = { projectId: 'project', lang: 'en', direction: 'ltr' as const, config: null };
const final: AiChatFinalEvent = {
  conversationId: '00000000-0000-4000-8000-000000000001',
  turnId: '00000000-0000-4000-8000-000000000002',
  status: 'answered',
  answer: 'Verified answer [S1]',
  citations: [
    {
      id: 'S1',
      pageId: 'page',
      title: 'Getting started',
      path: 'guide',
      heading: 'Install',
      anchor: 'install',
      snippet: 'Useful steps',
      direction: 'ltr',
    },
  ],
  suggestions: [],
  feedbackToken: '1234567890123456',
  language: 'en',
  limits: { turnsRemaining: 10, quotaRemaining: 10 },
};
const mount = () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const render = (node: ReactNode) => act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  const unmount = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { container, render, unmount };
};
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe('reader chat messages', () => {
  it('replaces a streamed draft and turns citations into focusable chips', async () => {
    const { container, render, unmount } = mount();
    const message = (payload?: AiChatFinalEvent) => (
      <ChatMessage text="Unverified draft" final={payload} options={options} busy={!payload} consent="not_required" close={vi.fn()} />
    );
    await render(message());
    expect(container.textContent).toContain('Unverified draft');
    await render(message(final));
    expect(container.textContent).toContain('Verified answer');
    expect(container.textContent).not.toContain('Unverified draft');
    expect(container.querySelector('a')?.closest('li[dir]')?.textContent).toContain('Getting started');
    expect(container.querySelector('a')?.textContent).toContain('Install');
    const chip = container.querySelector<HTMLButtonElement>('button[aria-label="Source 1"]');
    expect(chip).not.toBeNull();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    chip?.click();
    expect(document.activeElement?.textContent).toContain('Install');
    await unmount();
  });

  it('links sources in the language and version the turn was answered in', async () => {
    const { render, unmount } = mount();
    window.matchMedia = vi.fn(() => ({ matches: false }) as unknown as MediaQueryList);
    const arabic = {
      ...final,
      language: 'ar',
      citations: [{ ...final.citations[0], language: 'en', anchor: 'انتهاء-صلاحية-الرمز' } as (typeof final.citations)[number]],
    };
    // The reader has since switched to English.
    await render(<ChatMessage text="" final={arabic} options={options} busy={false} consent="granted" close={vi.fn()} scope={{ version: 'v1' }} />);
    const href = document.getElementById('00000000-0000-4000-8000-000000000002-source-1')?.getAttribute('href') ?? '';
    expect(href).toContain('lang=en');
    expect(href).toContain('v1');
    expect(decodeURIComponent(href)).toContain('#انتهاء-صلاحية-الرمز');
    await unmount();
  });

  it('numbers sources in the order they are listed, in the answer and on the cards', async () => {
    const { container, render, unmount } = mount();
    const [first] = final.citations;
    if (!first) throw new Error('fixture');
    const cited: AiChatFinalEvent = {
      ...final,
      answer: 'Install it [S3]. Then sign in [S2].',
      citations: [
        { ...first, id: 'S3', title: 'Install' },
        { ...first, id: 'S2', pageId: 'other', title: 'Sign in', anchor: 'sign-in' },
      ],
    };
    await render(<ChatMessage text="" final={cited} options={options} busy={false} consent="granted" close={vi.fn()} />);
    const chips = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Source "]')].map((chip) => chip.textContent);
    expect(chips).toEqual(['1', '2']);
    expect(container.querySelector('button[aria-label="Source 3"]')).toBeNull();
    const cards = [...container.querySelectorAll('a')].map((card) => card.textContent);
    expect(cards).toEqual(['1InstallUseful steps', '2InstallUseful steps']);
    expect([...container.querySelectorAll('li[dir] > p')].map((page) => page.textContent)).toEqual(['Install', 'Sign in']);
    await unmount();
  });

  it('lists a page once with its cited sections, and copies clean text with numbered sources', async () => {
    const { container, render, unmount } = mount();
    const [first] = final.citations;
    if (!first) throw new Error('fixture');
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const cited: AiChatFinalEvent = {
      ...final,
      answer: 'Install **it**. [S1]\n\nThen sign in. [S2]\n\nIt updates itself. [S4]',
      citations: [
        first,
        { ...first, id: 'S2', heading: 'Sign in', anchor: 'sign-in' },
        { ...first, id: 'S4', snippet: 'Another chunk of the install section' },
      ],
    };
    await render(<ChatMessage text="" final={cited} options={options} busy={false} consent="granted" close={vi.fn()} />);
    expect([...container.querySelectorAll('li[dir] > p')].map((page) => page.textContent)).toEqual(['Getting started']);
    expect([...container.querySelectorAll('li[dir] a')].map((section) => section.getAttribute('href'))).toEqual([
      '/guide?lang=en#install',
      '/guide?lang=en#sign-in',
    ]);
    expect([...container.querySelectorAll('button[data-citation]')].map((chip) => chip.textContent)).toEqual(['1', '2', '1']);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Copy answer"]')?.click());
    expect(writeText).toHaveBeenCalledWith(
      [
        'Install it. [1]',
        '',
        'Then sign in. [2]',
        '',
        'It updates itself. [1]',
        '',
        'Sources',
        '[1] Getting started › Install',
        `${window.location.origin}/guide?lang=en#install`,
        '[2] Getting started › Sign in',
        `${window.location.origin}/guide?lang=en#sign-in`,
      ].join('\n'),
    );
    await unmount();
  });

  it('links each source to its exact section and reports opens, copies and follow-ups', async () => {
    const { container, render, unmount } = mount();
    const onSourceOpen = vi.fn();
    const onFollowUp = vi.fn();
    window.matchMedia = vi.fn(() => ({ matches: false }) as unknown as MediaQueryList);
    await render(
      <ChatMessage
        text=""
        final={final}
        options={options}
        busy={false}
        consent="granted"
        close={vi.fn()}
        followUps={['Can I install it offline?', 'How do I update?']}
        onFollowUp={onFollowUp}
        onSourceOpen={onSourceOpen}
      />,
    );
    const card = document.getElementById('00000000-0000-4000-8000-000000000002-source-1');
    expect(card?.getAttribute('href')).toBe('/guide?lang=en#install');
    card?.addEventListener('click', (event) => event.preventDefault(), { once: true });
    card?.click();
    expect(onSourceOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'S1' }), 1);
    expect(container.textContent).toContain('Related questions');
    const chips = [...container.querySelectorAll('button')].filter((button) => button.textContent === 'How do I update?');
    chips[0]?.click();
    expect(onFollowUp).toHaveBeenCalledWith('How do I update?', 2);
    await unmount();
  });

  it('lays out each answer by its own script, since it follows the question language', async () => {
    const { container, render, unmount } = mount();
    await render(
      <ChatMessage
        text="draft"
        final={{ ...final, status: 'no_answer', answer: 'لم أجد إجابة في الوثائق.', citations: [], suggestions: [] }}
        options={options}
        busy={false}
        consent="unknown"
        close={vi.fn()}
      />,
    );
    expect(container.querySelector('p')?.getAttribute('dir')).toBe('auto');
    await render(<ChatMessage text="draft" final={final} options={options} busy={false} consent="unknown" close={vi.fn()} />);
    const paragraphs = [...container.querySelectorAll('p')];
    expect(paragraphs.length).toBeGreaterThan(0);
    for (const paragraph of paragraphs.filter((p) => p.closest('[dir="auto"]'))) expect(paragraph.closest('[dir]')?.getAttribute('dir')).toBe('auto');
    unmount();
  });

  it('shows the localized refusal and support link without unrelated source cards', async () => {
    const { container, render, unmount } = mount();
    await render(
      <ChatMessage
        text="draft"
        final={{
          ...final,
          status: 'no_answer',
          answer: 'Try searching with different words.',
          citations: [],
          suggestions: final.citations,
          supportUrl: 'https://help.example.com',
        }}
        options={options}
        busy={false}
        consent="unknown"
        close={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Try searching with different words.');
    expect(container.textContent).not.toContain('These articles might help');
    expect(container.querySelector('a[href*=guide]')).toBeNull();
    const support = [...container.querySelectorAll('a')].find((link) => link.textContent === 'Contact support');
    expect(support?.getAttribute('href')).toBe('https://help.example.com');
    expect(support?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await render(
      <ChatMessage
        text=""
        final={{ ...final, status: 'no_answer', language: 'ar', answer: 'لم أجد إجابة واضحة في الدليل.' }}
        options={{ ...options, lang: 'ar', direction: 'rtl' }}
        busy={false}
        consent="unknown"
        close={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('لم أجد إجابة واضحة في الدليل.');
    expect(container.textContent).not.toContain('تواصل مع الدعم');
    await render(
      <ChatMessage
        text={'[bad](https://evil.test) <img src=x onerror=alert(1) />'}
        options={options}
        busy={true}
        consent="unknown"
        close={vi.fn()}
      />,
    );
    expect(container.querySelector('a, img, script')).toBeNull();
    await unmount();
  });

  it('shows a rating at once, rolls it back when saving fails, and sends the previous rating on a change', async () => {
    const { container, render, unmount } = mount();
    await render(<ChatMessage text="" final={final} options={options} busy={false} consent="granted" close={vi.fn()} />);
    const up = () => container.querySelector<HTMLButtonElement>('button[aria-label="Helpful answer"]');
    const down = () => container.querySelector<HTMLButtonElement>('button[aria-label="Unhelpful answer"]');
    let reject: (error: Error) => void = () => undefined;
    mocks.feedback.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await act(async () => up()?.click());
    expect(up()?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => reject(new Error('offline')));
    await settle();
    expect(up()?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    mocks.feedback.mockResolvedValue({ saved: true });
    await act(async () => up()?.click());
    await settle();
    await act(async () => down()?.click());
    await settle();
    expect(mocks.feedback.mock.calls.at(-1)?.[0].data).toMatchObject({ rating: 'down', previousRating: 'up' });
    expect(down()?.getAttribute('aria-pressed')).toBe('true');
    await unmount();
  });

  it('lets details wait for the rating’s save, so the two writes never cross', async () => {
    const { container, render, unmount } = mount();
    mocks.feedback.mockClear();
    await render(<ChatMessage text="" final={final} options={options} busy={false} consent="granted" close={vi.fn()} />);
    const button = (label: string) => [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
    let finish: (value: unknown) => void = () => undefined;
    mocks.feedback.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Unhelpful answer"]')?.click());
    await act(async () => button('Incomplete')?.click());
    // The thumbs-down is still saving: details cannot be sent yet.
    expect(button('Send')?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saving your rating…');
    mocks.feedback.mockResolvedValue({ saved: true });
    await act(async () => finish({ saved: true }));
    await settle();
    expect(button('Send')?.disabled).toBe(false);
    expect(container.textContent).not.toContain('Saving your rating…');
    await act(async () => button('Send')?.click());
    await settle();
    // One write after the other: the details update the saved rating, never race it.
    expect(mocks.feedback).toHaveBeenCalledTimes(2);
    expect(mocks.feedback.mock.calls[1]?.[0].data).toMatchObject({ rating: 'down', reason: 'incomplete', previousRating: 'down' });
    await unmount();
  });
});
