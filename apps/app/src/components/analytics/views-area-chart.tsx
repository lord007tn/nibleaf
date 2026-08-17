import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@nibleaf/design-system/components/ui/chart';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import type { AnalyticsRange } from '@/hooks/api';
import { useFormatters } from '@/lib/format';
import { useT } from '@/lib/i18n';

const RANGES: AnalyticsRange[] = ['7d', '30d', '90d'];

/**
 * The dashboard-01 "interactive" chart: a gradient area of page views over time
 * with a range toggle. The parent owns the selected range (so the data query
 * refetches); this component just renders + switches.
 */
export function ViewsAreaChart({
  title,
  description,
  data,
  range,
  onRangeChange,
  loading,
}: {
  title: string;
  description: string;
  data: Array<{ date: string; views: number }>;
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
  loading?: boolean;
}) {
  const t = useT();
  const { shortDate } = useFormatters();
  const chartConfig = { views: { label: t('analytics.pageviews'), color: 'var(--chart-1)' } } satisfies ChartConfig;
  const hasData = data.some((d) => d.views > 0);

  return (
    <Card className="@container/chart">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction className="col-span-full col-start-1 row-start-3 mt-2 justify-self-stretch sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:justify-self-end">
          <div className="grid grid-cols-3 items-center gap-1 rounded-lg bg-muted p-0.5 sm:flex">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRangeChange(r)}
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-1 font-medium text-xs transition-colors',
                  range === r ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`analytics.range.${r}` as 'analytics.range.7d')}
              </button>
            ))}
          </div>
        </CardAction>
      </CardHeader>
      <div className="px-2 pb-4 sm:px-6">
        {loading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : hasData ? (
          <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full">
            <AreaChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
              <defs>
                <linearGradient id="fillViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-views)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="var(--color-views)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={(value) => shortDate(value)} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(value) => shortDate(value as string)} indicator="dot" />} />
              <Area dataKey="views" type="natural" fill="url(#fillViews)" stroke="var(--color-views)" strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        ) : (
          <div className="grid h-[240px] place-items-center text-center text-muted-foreground text-sm">{t('analytics.empty.traffic')}</div>
        )}
      </div>
    </Card>
  );
}
