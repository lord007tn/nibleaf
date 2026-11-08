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

/** One row per bucket: the bucket key plus a value (or null = unknown) per series. */
export type ChartRow = Record<string, string | number | null>;

/** What the values measure: counts, durations (ms) or AI spend (USD). */
export type TrendValueKind = 'count' | 'ms' | 'usd';

const hasValues = (rows: readonly ChartRow[], series: readonly TrendSeries[]) =>
  rows.some((row) => series.some((item) => typeof row[item.key] === 'number' && (row[item.key] as number) > 0));

/** Daily buckets are "YYYY-MM-DD"; hourly ones carry a time ("YYYY-MM-DDTHH:00"). */
export const granularityOf = (rows: readonly ChartRow[], xKey = 'bucket'): 'hour' | 'day' =>
  rows.some((row) => String(row[xKey] ?? '').includes('T')) ? 'hour' : 'day';

/**
 * The one time-series plot of the dashboard: page views on the overviews, every
 * insights section and the AI conversation charts. Built on the design-system
 * ChartContainer; ticks and tooltips go through the locale formatters, buckets
 * are read as the viewer's calendar days, and the container is pinned to LTR
 * (time runs left→right in every language) while the tooltip text follows the
 * interface direction. Loading, unknown and empty states keep the plot's
 * height so nothing shifts, and the figure carries a text summary for screen
 * readers.
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
  xKey = 'bucket',
  height = 'h-[240px]',
  className,
}: {
  rows: readonly ChartRow[];
  series: readonly TrendSeries[];
  granularity: 'hour' | 'day';
  /** Screen-reader description of what the chart shows. */
  summary: string;
  stacked?: boolean;
  loading?: boolean;
  unknown?: boolean;
  empty: string;
  valueKind?: TrendValueKind;
  /** The row field holding the bucket (`YYYY-MM-DD` or `YYYY-MM-DDTHH:00`). */
  xKey?: string;
  /** Tailwind height class of the plot area. */
  height?: string;
  className?: string;
}) {
  const t = useT();
  const direction = useDirection();
  const format = useInsightFormat();
  const gradientPrefix = `fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (loading) {
    // A block the chart's height, plus the legend row when there is one, so nothing shifts when it draws.
    return (
      <div aria-hidden className={className} data-chart-skeleton="">
        <Skeleton className={cn(height, 'w-full')} />
        {series.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-4">
            {series.map((item) => (
              <Skeleton className="h-4 w-20" key={item.key} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (unknown || !hasValues(rows, series)) {
    return (
      <div className={cn('grid place-items-center px-4 text-center text-muted-foreground text-sm', height, className)} data-chart-empty="">
        {unknown ? t('analytics.state.unknown') : empty}
      </div>
    );
  }
  const config = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }])) satisfies ChartConfig;
  const tick = (value: unknown) => format.bucket(String(value), granularity);
  const formatValue = (value: number | null) => {
    if (value === null) return UNKNOWN;
    if (valueKind === 'ms') return format.ms(value);
    if (valueKind === 'usd') return format.usd(value);
    return format.count(value);
  };
  const showDots = rows.length <= 2;

  return (
    <figure aria-label={summary} className={cn('m-0 min-w-0', className)} role="img">
      <ChartContainer config={config} className={cn('aspect-auto w-full', height)} dir="ltr">
        <ComposedChart accessibilityLayer={false} data={rows as ChartRow[]} margin={{ left: 4, right: 4, top: 8 }}>
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
          <XAxis axisLine={false} dataKey={xKey} minTickGap={28} tickFormatter={tick} tickLine={false} tickMargin={8} />
          <YAxis
            allowDecimals={valueKind === 'usd'}
            axisLine={false}
            tickFormatter={(value: number) => formatValue(value)}
            tickLine={false}
            width="auto"
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="min-w-40"
                labelFormatter={(_, payload) => format.bucketLong(String(payload?.[0]?.payload?.[xKey] ?? ''), granularity)}
                valueFormatter={(value) => formatValue(value)}
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
                name={item.key}
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
                name={item.key}
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
    </figure>
  );
}

/** Plain-language summary of one series for the chart's accessible name. */
export function useSeriesSummary() {
  const t = useT();
  const format = useInsightFormat();
  return (label: string, points: readonly SeriesPoint[], granularity: 'hour' | 'day') => {
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
