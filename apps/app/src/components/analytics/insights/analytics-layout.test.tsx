// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ t: (key: string) => key, locale: 'en' }), useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children?: ReactNode }) => <a href="/overview">{children}</a> }));
vi.mock('@/hooks/api', () => ({ useDeployments: () => ({ data: [] }), useProject: () => ({ data: undefined }) }));
vi.mock('./use-insight-format', () => ({ useInsightFormat: () => ({ dateTime: () => 'then', relativeTime: () => 'now' }) }));
vi.mock('./filter-bar', () => ({ InsightsFilterBar: () => <div data-testid="filters" /> }));
vi.mock('./section-nav', () => ({ InsightsSectionNav: () => <nav data-testid="sections" /> }));

import { AnalyticsLayout } from './analytics-layout';
import type { InsightsState } from './insights-data';
import { InsightsStatus } from './insights-status';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const off: InsightsState = { loading: false, availability: 'not_configured', unknown: true };
const on: InsightsState = { loading: false, availability: 'complete', unknown: false, lastEventAt: null };

describe('Analytics with detailed analytics off (WORKSPACE-01)', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const draw = (projectId: string, state: InsightsState) =>
    act(async () =>
      root.render(
        <AnalyticsLayout
          filters={{ range: '30d', compare: 'previous' } as never}
          onFiltersChange={() => undefined}
          projectId={projectId}
          timezone="UTC"
        >
          <InsightsStatus projectId={projectId} state={state} />
        </AnalyticsLayout>,
      ),
    );

  it('keeps the filters and section links while the section has figures', async () => {
    await draw('p1', on);
    expect(container.querySelector('[data-testid="filters"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="sections"]')).not.toBeNull();
  });

  it('drops the controls that could change nothing and shows one notice', async () => {
    await draw('p1', off);
    expect(container.querySelector('[data-testid="filters"]')).toBeNull();
    expect(container.querySelector('[data-testid="sections"]')).toBeNull();
    expect(container.querySelectorAll('[data-slot="empty-state"]')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('analytics.title');
  });

  it('brings the controls back when the same site later has figures (a refetch after setup)', async () => {
    await draw('p1', off);
    await draw('p1', on);
    expect(container.querySelector('[data-testid="filters"]')).not.toBeNull();
  });

  it('asks again for another site', async () => {
    await draw('p1', off);
    await draw('p2', on);
    expect(container.querySelector('[data-testid="filters"]')).not.toBeNull();
  });
});
