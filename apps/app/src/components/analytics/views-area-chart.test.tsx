// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('./views-timeseries-chart', () => ({ ViewsTimeseriesChart: () => <div data-testid="chart" /> }));

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
});
