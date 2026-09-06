import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@nibleaf/design-system/components/ui/chart';
import { useDirection } from '@nibleaf/design-system/components/ui/direction';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { useFormatters } from '@/lib/format';
import { parseSeriesDate } from './chart-format';

export interface ViewsPoint {
  date: string;
  views: number;
}

/**
 * The page-views-over-time plot shared by the overviews and both analytics
 * pages, so axes, tooltip and colours are identical everywhere. Ticks and the
 * tooltip go through the locale formatters (Arabic-Indic digits in Arabic).
 * Recharts lays the plot out left→right whatever the writing direction, so the
 * container is pinned to `dir="ltr"`; only the tooltip text follows the
 * interface direction.
 */
export function ViewsTimeseriesChart({ data, className }: { data: ViewsPoint[]; className?: string }) {
  const t = useT();
  const direction = useDirection();
  const { number, shortDate } = useFormatters();
  const gradientId = `fill-views-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const chartConfig = { views: { label: t('analytics.pageviews'), color: 'var(--chart-1)' } } satisfies ChartConfig;
  const dateTick = (value: unknown) => shortDate(parseSeriesDate(String(value)));

  return (
    <ChartContainer config={chartConfig} className={cn('aspect-auto h-[240px] w-full', className)} dir="ltr">
      <AreaChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-views)" stopOpacity={0.7} />
            <stop offset="95%" stopColor="var(--color-views)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={dateTick} />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} width="auto" tickFormatter={(value: number) => number(value)} />
        <ChartTooltip
          cursor={false}
          wrapperStyle={{ direction }}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => dateTick(value)}
              formatter={(value) => (
                <div className="flex flex-1 items-center justify-between gap-2 leading-none">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-[2px] bg-(--color-views)" />
                    {t('analytics.pageviews')}
                  </span>
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {typeof value === 'number' ? number(value) : String(value)}
                  </span>
                </div>
              )}
            />
          }
        />
        {/* A tiny series (24h ⇒ 1–2 points) has no visible line, so draw the points. */}
        <Area dataKey="views" type="monotone" fill={`url(#${gradientId})`} stroke="var(--color-views)" strokeWidth={2} dot={data.length <= 2} />
      </AreaChart>
    </ChartContainer>
  );
}
