// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Recharts draws nothing measurable in jsdom; record what the chart asks it to draw instead.
const drawn = vi.hoisted(() => ({ areas: [] as Record<string, unknown>[], lines: [] as Record<string, unknown>[], yAxes: [] as Record<string, unknown>[] }));
vi.mock('recharts', () => {
  const pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ComposedChart: pass,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: (props: Record<string, unknown>) => {
      drawn.yAxes.push(props);
      return null;
    },
    Area: (props: Record<string, unknown>) => {
      drawn.areas.push(props);
      return null;
    },
    Line: (props: Record<string, unknown>) => {
      drawn.lines.push(props);
      return null;
    },
  };
});
vi.mock('@nibleaf/design-system/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

import { TrendChart } from './trend-chart';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const container = document.createElement('div');
const root = createRoot(container);

afterEach(async () => {
  await act(async () => root.render(null));
  drawn.areas.length = 0;
  drawn.lines.length = 0;
  drawn.yAxes.length = 0;
});

const series = [
  { key: 'views', label: 'Views', color: 'var(--chart-1)' },
  { key: 'previous', label: 'Previous', color: 'var(--chart-3)', dashed: true },
];
const rows = (peak: number) =>
  ['2026-11-01', '2026-11-02', '2026-11-03'].map((bucket, index) => ({ bucket, views: index === 1 ? peak : 1, previous: 1 }));
const render = (peak: number, valueKind?: 'count' | 'ms' | 'usd') =>
  act(async () =>
    root.render(<TrendChart empty="none" granularity="day" rows={rows(peak)} series={series} summary="s" valueKind={valueKind} />),
  );

describe('TrendChart draws without motion or layout jumps (WORKSPACE-14)', () => {
  it('never animates its areas or lines, so a remount or a new range never starts from a blank plot', async () => {
    await render(12);
    expect(drawn.areas.length).toBeGreaterThan(0);
    expect(drawn.lines.length).toBeGreaterThan(0);
    for (const mark of [...drawn.areas, ...drawn.lines]) expect(mark.isAnimationActive).toBe(false);
  });

  it.each(['count', 'ms', 'usd'] as const)('keeps one value-axis width for small and large %s values', async (kind) => {
    await render(3, kind);
    const small = drawn.yAxes.at(-1)?.width;
    await render(4_500_000, kind);
    const large = drawn.yAxes.at(-1)?.width;
    expect(typeof small).toBe('number');
    expect(large).toBe(small);
  });

  it('shortens large counts on the axis so they fit that width', async () => {
    await render(4_500_000);
    const tick = drawn.yAxes.at(-1)?.tickFormatter as (value: number) => string;
    expect(tick(4_500_000).length).toBeLessThanOrEqual(5);
  });
});
