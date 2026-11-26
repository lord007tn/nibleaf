// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => ({ summary: undefined as unknown, list: undefined as unknown, gaps: undefined as unknown }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children?: ReactNode }) => <a href="/settings">{children}</a> }));
vi.mock('@/hooks/api', () => ({ useLanguages: () => ({ data: [] }) }));
vi.mock('@/hooks/api/ai-conversations', () => ({
  conversationFilters: () => ({}),
  useAiConversationSummary: () => data.summary,
  useAiConversations: () => data.list,
  useAiContentGaps: () => data.gaps,
}));
vi.mock('./detail', () => ({ ConversationDetail: () => null }));
vi.mock('./overview', () => ({ Overview: () => <div data-testid="overview" /> }));
vi.mock('./gaps', () => ({ ContentGaps: () => null }));
vi.mock('./conversation-list', () => ({ ConversationList: () => null }));

import { AiDashboard } from './dashboard';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const query = (value: unknown) => ({ data: value, isPending: false, isError: false, refetch: vi.fn() });
const summary = (overrides: Record<string, unknown>) => ({
  availability: 'complete',
  captureEnabled: true,
  captureOffReason: null,
  totals: { questions: 3 },
  languages: [],
  ...overrides,
});

describe('Reader questions page notices (WORKSPACE-02)', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    data.list = query(undefined);
    data.gaps = query(undefined);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const draw = () =>
    act(async () => root.render(<AiDashboard onChange={() => undefined} projectId="p1" search={{ tab: 'overview', range: '30d' }} />));

  it('replaces the whole body with one notice when there is no question history, never two banners', async () => {
    data.summary = query(summary({ availability: 'disabled', captureEnabled: false, captureOffReason: 'instance' }));
    await draw();
    expect(container.querySelectorAll('[data-slot="empty-state"]')).toHaveLength(1);
    expect(container.querySelector('[data-reason="notConfigured"] h2')?.textContent).toBe('dashboard.ai.unavailableTitle');
    expect(container.querySelectorAll('[role="alert"], [data-slot="alert"]')).toHaveLength(0);
    // No filters, tabs or range control that could change nothing.
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.querySelector('[data-testid="overview"]')).toBeNull();
    expect(container.textContent).not.toMatch(/selfHosting|captureInstance|server/i);
  });

  it('keeps the figures and says once that new questions are not saved yet', async () => {
    data.summary = query(summary({ captureEnabled: false, captureOffReason: 'instance' }));
    await draw();
    expect(container.querySelector('[data-testid="overview"]')).not.toBeNull();
    expect(container.textContent).toContain('dashboard.ai.notSavingYet');
    expect(container.querySelectorAll('[data-slot="alert"]')).toHaveLength(1);
  });

  it('shows a real empty state, with a heading, when a period has no questions', async () => {
    data.summary = query(summary({ totals: { questions: 0 } }));
    await draw();
    expect(container.querySelector('[data-slot="empty-state"] h2')?.textContent).toBe('dashboard.ai.emptyTitle');
  });
});
