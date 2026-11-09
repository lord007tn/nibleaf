// @vitest-environment jsdom

import type { AiConversationSummary } from '@nibleaf/validators';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', subscribeLanguage: () => () => undefined }));

import { Overview } from './overview';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

const day = (date: string, questions: number, costUsd: number | null) => ({
  date,
  questions,
  answered: questions,
  noAnswer: 0,
  up: 0,
  down: 0,
  inputTokens: questions * 100,
  outputTokens: questions * 300,
  costUsd,
});

const summary = (timeseries: AiConversationSummary['timeseries']): AiConversationSummary =>
  ({
    totals: { questions: 3, answered: 3, noAnswer: 0 },
    feedback: { up: 0, down: 0, reasons: [] },
    usage: { inputTokens: 300, outputTokens: 900, costUsd: null, costComplete: false },
    timeseries,
    languages: [],
    engagement: {
      opens: 0,
      opensBySource: [],
      citationClicks: 0,
      followUpClicks: 0,
      copies: 0,
      stops: 0,
      newChats: 0,
      feedbackGiven: 0,
      feedbackChanged: 0,
      quotaReached: 0,
      providerErrors: 0,
      medianFirstTokenMs: null,
      medianLatencyMs: null,
    },
  }) as unknown as AiConversationSummary;

/** The "Estimated cost over time" card. */
const costCard = (container: HTMLElement) =>
  [...container.querySelectorAll('section')].find((section) => section.querySelector('h2')?.textContent === 'dashboard.ai.costOverTime');

describe('AI cost chart states', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 8, 12));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('keeps unreported cost unknown even after quiet days are filled in', async () => {
    await act(async () => root.render(<Overview data={summary([day('2026-11-06', 3, null)])} />));
    const card = costCard(container);
    expect(card?.textContent).toContain('analytics.state.unknown');
    expect(card?.textContent).not.toContain('dashboard.ai.empty');
  });

  it('draws a known $0 spend instead of claiming there were no questions', async () => {
    await act(async () => root.render(<Overview data={summary([day('2026-11-06', 3, 0)])} />));
    const card = costCard(container);
    expect(card?.textContent).not.toContain('dashboard.ai.empty');
    expect(card?.querySelector('[role="img"]')).not.toBeNull();
  });

  it('describes the spend in dollars for screen readers', async () => {
    await act(async () => root.render(<Overview data={summary([day('2026-11-06', 3, 0.0042), day('2026-11-07', 1, 0.001)])} />));
    const label = costCard(container)?.querySelector('[role="img"]')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('analytics.chart.summary');
    expect(label).toContain('"total":"$0.0052"');
    expect(label).toContain('"peak":"$0.0042"');
  });
});
