import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@nibleaf/design-system/components/ui/chart';
import { useDirection } from '@nibleaf/design-system/components/ui/direction';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useId } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import type { SeriesPoint } from '@/hooks/api/analytics';
import { UNKNOWN, useInsightFormat } from './use-insight-format';

export interface TrendSeries {
  key: string;
  label: string;
  /** A design token, e.g. `var(--chart-1)`. */
  color: string;
  /** Drawn as a dashed line without fill (the previous-period overlay). */
  dashed?: boolean;
}

export type TrendRow = { bucket: string } & Record<string, number | string | null>;

/** Rows for a current series with the previous period overlaid point-by-point (same position in the period). */
export function alignWithPrevious(current: SeriesPoint[], previous: SeriesPoint[]): TrendRow[] {
  return current.map((point, index) => ({ bucket: point.bucket, current: point.value, previous: previous[index]?.value ?? null }));
}

/** Rows for several series that share the same buckets. */
export function mergeSeries(series: Array<{ key: string; points: SeriesPoint[] }>): TrendRow[] {
  const rows = new Map<string, TrendRow>();
  for (const { key, points } of series) {
    for (const point of points) {
      const row: TrendRow = rows.get(point.bucket) ?? { bucket: point.bucket };
      row[key] = point.value;
      rows.set(point.bucket, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

const hasValues = (rows: TrendRow[], series: TrendSeries[]) =>
  rows.some((row) => series.some((item) => typeof row[item.key] === 'number' && (row[item.key] as number) > 0));

/**
 * The insights timeseries plot. Same anatomy as ViewsTimeseriesChart (design
 * system ChartContainer, locale-formatted ticks, container pinned to LTR with
 * the tooltip text following the interface direction), extended with several
 * series, optional stacking and a dashed previous-period overlay. The figure
 * carries a text summary for screen readers.
 */
export function TrendChart({
  rows,
  series,
  granularity,
  summary,
  stacked,
  loading,
  unknown,
  empty,
  valueKind = 'count',
  className,
}: {
  rows: TrendRow[];
  series: TrendSeries[];
  granularity: 'hour' | 'day';
  /** Screen-reader description of what the chart shows. */
  summary: string;
  stacked?: boolean;
  loading?: boolean;
  unknown?: boolean;
  empty: string;
  valueKind?: 'count' | 'ms';
  className?: string;
}) {
  const t = useT();
  const direction = useDirection();
  const format = useInsightFormat();
  const gradientPrefix = `fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const height = 'h-[240px]';
  if (loading) return <Skeleton className={cn(height, 'w-full')} />;
  if (unknown || !hasValues(rows, series)) {
    return (
      <div className={cn('grid place-items-center text-center text-muted-foreground text-sm', height)}>
        {unknown ? t('analytics.state.unknown') : empty}
      </div>
    );
  }
  const config = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }])) satisfies ChartConfig;
  const tick = (value: unknown) => format.bucket(String(value), granularity);
  const formatValue = (value: unknown) => (typeof value === 'number' ? (valueKind === 'ms' ? format.ms(value) : format.count(value)) : UNKNOWN);
  const showDots = rows.length <= 2;

  return (
    <div aria-label={summary} className={className} role="img">
      <ChartContainer config={config} className={cn('aspect-auto w-full', height)} dir="ltr">
        <ComposedChart accessibilityLayer={false} data={rows} margin={{ left: 4, right: 4, top: 8 }}>
          <defs>
            {series
              .filter((item) => !item.dashed)
              .map((item) => (
                <linearGradient id={`${gradientPrefix}-${item.key}`} key={item.key} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor={`var(--color-${item.key})`} stopOpacity={stacked ? 0.5 : 0.6} />
                  <stop offset="95%" stopColor={`var(--color-${item.key})`} stopOpacity={0.05} />
                </linearGradient>
              ))}
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis axisLine={false} dataKey="bucket" minTickGap={28} tickFormatter={tick} tickLine={false} tickMargin={8} />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickFormatter={(value: number) => (valueKind === 'ms' ? format.ms(value) : format.count(value))}
            tickLine={false}
            width="auto"
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => {
                  const item = series.find((entry) => entry.key === name);
                  return (
                    <div className="flex flex-1 items-center justify-between gap-3 leading-none">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: `var(--color-${String(name)})` }} />
                        {item?.label ?? String(name)}
                      </span>
                      <span className="font-mono font-medium text-foreground tabular-nums">{formatValue(value)}</span>
                    </div>
                  );
                }}
                labelFormatter={(value) => tick(value)}
              />
            }
            cursor={false}
            wrapperStyle={{ direction }}
          />
          {series.map((item) =>
            item.dashed ? (
              <Line
                connectNulls
                dataKey={item.key}
                dot={showDots}
                isAnimationActive={false}
                key={item.key}
                stroke={`var(--color-${item.key})`}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                type="monotone"
              />
            ) : (
              <Area
                dataKey={item.key}
                dot={showDots}
                fill={`url(#${gradientPrefix}-${item.key})`}
                key={item.key}
                stackId={stacked ? 'stack' : undefined}
                stroke={`var(--color-${item.key})`}
                strokeWidth={2}
                type="monotone"
              />
            ),
          )}
        </ComposedChart>
      </ChartContainer>
      {series.length > 1 ? (
        <ul aria-hidden className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
          {series.map((item) => (
            <li className="flex items-center gap-1.5" key={item.key}>
              <span
                className={cn('inline-block h-0.5 w-4 rounded-full', item.dashed && 'border-t-2 border-dashed bg-transparent')}
                style={item.dashed ? { borderColor: item.color } : { backgroundColor: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Plain-language summary of one series for the chart's accessible name. */
export function useSeriesSummary() {
  const t = useT();
  const format = useInsightFormat();
  return (label: string, points: SeriesPoint[], granularity: 'hour' | 'day') => {
    if (points.length === 0) return t('analytics.chart.summaryEmpty', { label });
    const total = points.reduce((sum, point) => sum + point.value, 0);
    const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0] as SeriesPoint);
    return t('analytics.chart.summary', {
      label,
      total: format.count(total),
      peak: format.count(peak.value),
      date: format.bucket(peak.bucket, granularity),
    });
  };
}
