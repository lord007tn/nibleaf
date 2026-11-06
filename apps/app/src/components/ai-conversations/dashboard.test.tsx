// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversationFilters } from '@/hooks/api/ai-conversations';
import { ConversationList } from './conversation-list';
import { DeleteConversationButton } from './detail';
import { GapList } from './gaps';
import { CostValue, Engagement } from './overview';
import { aiDashboardSearch } from './search';

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string>) => `${key}${variables ? JSON.stringify(variables) : ''}`,
}));
vi.mock('@/hooks/api', () => ({ useProjectMembers: vi.fn() }));
vi.mock('@/hooks/api/ai-conversations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/api/ai-conversations')>()),
  useAiConversation: vi.fn(),
  useDeleteAiConversation: vi.fn(),
}));
vi.mock('@/services/auth-client', () => ({ useSession: vi.fn() }));
vi.mock('@/lib/format', () => ({
  useFormatters: () => ({ number: String, currency: (value: number) => `$${value}`, dateTime: String, relativeTime: () => 'recently' }),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
});
async function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() => root.render(element));
  return container;
}
const item = {
  conversationId: 'chat',
  startedAt: '2026-11-01',
  lastActivityAt: '2026-11-02',
  language: 'ar',
  turns: 2,
  firstQuestion: null,
  answered: 1,
  noAnswer: 1,
  failed: 0,
  rating: null,
  pagePath: '/guide',
} as const;
describe('AI dashboard', () => {
  it('validates deep links and maps only API filters', () => {
    const search = aiDashboardSearch.parse({
      tab: 'conversations',
      range: '7d',
      language: 'ar',
      rating: 'down',
      status: 'no_answer',
      q: ' setup ',
      conversation: 'chat',
    });
    expect(conversationFilters(search)).toEqual({ range: '7d', language: 'ar', rating: 'down', status: 'no_answer', q: 'setup' });
    expect(aiDashboardSearch.parse({ tab: 'invalid', range: '24h', rating: 'bad' })).toEqual({ tab: 'overview', range: '30d', rating: undefined });
    const params = Object.fromEntries(
      new URLSearchParams(Object.entries(conversationFilters(search)).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]]))),
    );
    expect(conversationFilters(aiDashboardSearch.parse(params))).toEqual(conversationFilters(search));
  });
  it('renders unsaved questions and supports keyboard row activation', async () => {
    const open = vi.fn();
    const container = await render(<ConversationList items={[item]} onOpen={open} />);
    expect(container.textContent).toContain('dashboard.ai.notSaved');
    expect(container.textContent).not.toContain('null');
    expect(container.querySelectorAll('th')).toHaveLength(7);
    await act(() => container.querySelector('tbody tr')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(open).toHaveBeenCalledWith('chat');
  });
  it('keeps unknown cost distinct from zero and marks incomplete cost', () => {
    expect(renderToStaticMarkup(<CostValue usage={{ costUsd: null, costComplete: false, inputTokens: 30, outputTokens: 4 }} />)).toContain(
      'dashboard.ai.unknownCost',
    );
    expect(renderToStaticMarkup(<CostValue usage={{ costUsd: 0, costComplete: true, inputTokens: 0, outputTokens: 0 }} />)).toContain('$0');
    expect(renderToStaticMarkup(<CostValue usage={{ costUsd: 0.03, costComplete: false, inputTokens: 30, outputTokens: 4 }} />)).toContain(
      'dashboard.ai.atLeast',
    );
  });
  it('offers gap actions with the question and sample conversation', async () => {
    const write = vi.fn();
    const open = vi.fn();
    const container = await render(
      <GapList
        items={[
          {
            question: 'How to start?',
            language: 'en',
            askedCount: 3,
            noAnswerCount: 2,
            downCount: 1,
            lastAskedAt: '2026-11-02',
            sampleConversationId: 'chat',
            reason: 'no_answer',
          },
        ]}
        onWrite={write}
        onOpen={open}
      />,
    );
    const buttons = container.querySelectorAll('button');
    await act(() => {
      buttons[0]?.click();
      buttons[1]?.click();
    });
    expect(write).toHaveBeenCalledWith('How to start?');
    expect(open).toHaveBeenCalledWith('chat');
  });
  it('exposes delete only to an authorized admin and disables it while pending', () => {
    expect(renderToStaticMarkup(<DeleteConversationButton allowed={false} pending={false} onDelete={vi.fn()} />)).toBe('');
    expect(renderToStaticMarkup(<DeleteConversationButton allowed pending onDelete={vi.fn()} />)).toContain('disabled');
  });
});

it('renders engagement counts and unknown timing in plain-language labels', () => {
  const html = renderToStaticMarkup(
    <Engagement
      data={{
        opens: 2,
        opensBySource: [{ source: 'launcher', count: 2 }],
        citationClicks: 3,
        followUpClicks: 1,
        copies: 0,
        stops: 0,
        newChats: 0,
        feedbackGiven: 1,
        feedbackChanged: 0,
        quotaReached: 0,
        providerErrors: 0,
        medianFirstTokenMs: null,
        medianLatencyMs: 123,
      }}
    />,
  );
  expect(html).toContain('dashboard.ai.launcher');
  expect(html).toContain('dashboard.ai.noTiming');
  expect(html).toContain('123');
});
