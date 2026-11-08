// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

import { ViewsAreaChart } from './views-area-chart';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const container = document.createElement('div');
const root = createRoot(container);

afterEach(async () => {
  await act(async () => root.render(null));
});

const render = (props: { unavailable?: boolean; data?: Array<{ date: string; views: number }> }) =>
  act(async () =>
    root.render(
      <ViewsAreaChart
        data={props.data ?? []}
        description="d"
        onRangeChange={() => undefined}
        range="30d"
        title="t"
        unavailable={props.unavailable}
      />,
    ),
  );

describe('ViewsAreaChart empty states', () => {
  it('says the views are unknown when they could not be loaded', async () => {
    await render({ unavailable: true });
    expect(container.textContent).toContain('analytics.state.unknown');
    expect(container.textContent).not.toContain('analytics.empty.traffic');
  });

  it('keeps "no traffic yet" for a site that really had no views', async () => {
    await render({ data: [{ date: '2026-11-01', views: 0 }] });
    expect(container.textContent).toContain('analytics.empty.traffic');
  });

  it('draws the shared chart with a screen-reader summary once there are views', async () => {
    await render({
      data: [
        { date: '2026-11-01', views: 3 },
        { date: '2026-11-02', views: 9 },
        { date: '2026-11-03', views: 4 },
      ],
    });
    const figure = container.querySelector('[role="img"]');
    expect(figure?.getAttribute('aria-label')).toBe('analytics.chart.summary');
    expect(container.textContent).not.toContain('analytics.empty.traffic');
  });
});
